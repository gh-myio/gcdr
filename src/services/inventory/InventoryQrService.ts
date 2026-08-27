// =============================================================================
// RFC-0061 M5 — QR services: scan-time validation (S2) and traceability (S5).
//
// S2 — POST /qr/validate: batch of codes + context (expectedItemId?,
// orderItemId?) → per-code verdict so handheld scanners can give green/red
// feedback per beep. The batch NEVER fails as a whole: every code gets a
// verdict (`ok` or an Appendix D reason). A box QR expands to its units.
//
// S5 — GET /qr/trace/:code: accepts the bare code (`\d+(_\d+)+`) or the full
// `https://produto.myio.com.br/<code>` URL (what a camera scan yields).
// Response = current-state header + normalized event timeline
// `{ts, type, actor, location, refs}` aggregating homologation, ledger
// entries/exits (inv_movement_qrs → inv_stock_movements), expedition baixas
// (inv_delivery_qrs → inv_item_deliveries → inv_expedition_orders — absent
// rows are normal until M6 ships) and box membership. Unknown QR → 404; a box
// QR expands its units, flagged as box.
// =============================================================================

import {
  InventoryHomologationRepository,
  inventoryHomologationRepository,
  InvHomologationRow,
  InvQrRegistryRow,
  QrDeliveryEventRow,
  QrMovementEventRow,
  UnitWithHomologationRow,
} from '../../repositories/inventory/InventoryHomologationRepository';
import { NotFoundError } from '../../shared/errors/AppError';
import { QR_BASE_URL } from './InventoryHomologationService';
import type { QrValidateDTO } from '../../dto/request/InventoryDTO';
import type { InvQrTraceEvent, InvQrTraceResponse } from '../../dto/response/InventoryResponseDTO';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type IInventoryQrRepository = Pick<
  InventoryHomologationRepository,
  | 'findRegistryByValues'
  | 'findUnitsByQrValues'
  | 'findBoxesByQrValues'
  | 'unitsByHomologationIds'
  | 'movementEventsByQrs'
  | 'deliveryEventsByQrs'
  | 'getExpeditionOrderItem'
>;

/** Per-unit verdict inside a box expansion. */
export interface QrUnitVerdict {
  qrValue: string;
  ok: boolean;
  reason?: string;
}

/** Per-code verdict (extends the P0 InvQrValidateVerdict shape with M5 fields). */
export interface QrVerdict {
  code: string;
  ok: boolean;
  reason?: string;
  itemId?: string | null;
  isBox?: boolean;
  units?: QrUnitVerdict[];
}

export interface QrValidateResult {
  results: QrVerdict[];
}

const EXIT_TYPES = new Set(['SAIDA', 'TRANSFERENCIA_OUT']);

/** Bare unit-code format kept from the source (§M5). */
export const QR_CODE_REGEX = /^\d+(_\d+)+$/;

// -----------------------------------------------------------------------------
// Normalization (S5 — bare code or full URL; camera scans yield the URL)
// -----------------------------------------------------------------------------

export interface NormalizedQr {
  /** Canonical bare code (URL prefix stripped when present). */
  code: string;
  /** Every spelling to match against stored values (bare + full URL + raw). */
  candidates: string[];
}

export function normalizeQrInput(raw: string): NormalizedQr {
  const trimmed = raw.trim();
  let code = trimmed;
  for (const prefix of [QR_BASE_URL, QR_BASE_URL.replace('https://', 'http://')]) {
    if (code.toLowerCase().startsWith(prefix.toLowerCase())) {
      code = code.slice(prefix.length);
      break;
    }
  }
  const candidates = new Set<string>([trimmed, code, `${QR_BASE_URL}${code}`]);
  return { code, candidates: [...candidates] };
}

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

export class InventoryQrService {
  private repository: IInventoryQrRepository;

  constructor(repository?: IInventoryQrRepository) {
    this.repository = repository ?? inventoryHomologationRepository;
  }

  // ---------------------------------------------------------------------------
  // S2 — batch validation
  // ---------------------------------------------------------------------------

  async validate(tenantId: string, dto: QrValidateDTO): Promise<QrValidateResult> {
    // Context: an explicit expected item wins; otherwise resolve it from the
    // expedition-order item when given (absent rows just drop the check).
    let expectedItemId = dto.expectedItemId ?? null;
    if (!expectedItemId && dto.orderItemId) {
      const orderItem = await this.repository.getExpeditionOrderItem(tenantId, dto.orderItemId);
      expectedItemId = orderItem?.itemId ?? null;
    }

    const normalized = dto.codes.map((c) => normalizeQrInput(c));
    const allCandidates = [...new Set(normalized.flatMap((n) => n.candidates))];

    const [registry, units, boxes] = await Promise.all([
      this.repository.findRegistryByValues(tenantId, allCandidates),
      this.repository.findUnitsByQrValues(tenantId, allCandidates),
      this.repository.findBoxesByQrValues(tenantId, allCandidates),
    ]);

    // Expand box units so usage checks cover them too.
    const boxUnits = await this.repository.unitsByHomologationIds(
      tenantId,
      boxes.map((b) => b.id),
    );
    const usageValues = [...new Set([...allCandidates, ...boxUnits.map((u) => u.qrValue)])];
    const [movementEvents, deliveryEvents] = await Promise.all([
      this.repository.movementEventsByQrs(tenantId, usageValues),
      this.repository.deliveryEventsByQrs(tenantId, usageValues),
    ]);

    const results = dto.codes.map((raw, i) => {
      const { candidates } = normalized[i];
      const inSet = (v: string | null | undefined): boolean => !!v && candidates.includes(v);

      const box = boxes.find((b) => inSet(b.boxQr));
      if (box) {
        return this.boxVerdict(raw, box, boxUnits.filter((u) => u.homologationId === box.id), expectedItemId, movementEvents, deliveryEvents);
      }

      const unit = units.find((u) => inSet(u.unit.qrValue));
      const registryRow = registry.find((r) => inSet(r.qrValue));
      if (!unit && !registryRow) {
        return { code: raw, ok: false, reason: 'INV_QR_NOT_IN_REGISTRY' } as QrVerdict;
      }

      const itemId = unit?.homologation.itemId ?? registryRow?.itemId ?? null;
      const values = [...candidates, ...(unit?.homologation.boxQr ? [unit.homologation.boxQr] : [])];
      const usage = this.usageOf(values, movementEvents, deliveryEvents);
      if (usage === 'USED') {
        return { code: raw, ok: false, reason: 'INV_QR_ALREADY_USED', itemId } as QrVerdict;
      }
      if (expectedItemId && itemId && itemId !== expectedItemId) {
        return { code: raw, ok: false, reason: 'INV_QR_WRONG_ITEM', itemId } as QrVerdict;
      }
      return { code: raw, ok: true, itemId } as QrVerdict;
    });

    return { results };
  }

  private boxVerdict(
    raw: string,
    box: InvHomologationRow,
    boxUnitRows: Array<{ qrValue: string }>,
    expectedItemId: string | null,
    movementEvents: QrMovementEventRow[],
    deliveryEvents: QrDeliveryEventRow[],
  ): QrVerdict {
    const unitVerdicts: QrUnitVerdict[] = boxUnitRows.map((u) => {
      const usage = this.usageOf([u.qrValue, ...(box.boxQr ? [box.boxQr] : [])], movementEvents, deliveryEvents);
      if (usage === 'USED') return { qrValue: u.qrValue, ok: false, reason: 'INV_QR_ALREADY_USED' };
      return { qrValue: u.qrValue, ok: true };
    });

    if (expectedItemId && box.itemId !== expectedItemId) {
      return {
        code: raw,
        ok: false,
        reason: 'INV_QR_WRONG_ITEM',
        itemId: box.itemId,
        isBox: true,
        units: unitVerdicts,
      };
    }
    const allOk = unitVerdicts.every((u) => u.ok);
    return {
      code: raw,
      ok: allOk,
      ...(allOk ? {} : { reason: 'INV_QR_ALREADY_USED' }),
      itemId: box.itemId,
      isBox: true,
      units: unitVerdicts,
    };
  }

  /** Usage state from the QR's event history: latest ledger event an exit, or any expedition baixa → USED. */
  private usageOf(
    values: string[],
    movementEvents: QrMovementEventRow[],
    deliveryEvents: QrDeliveryEventRow[],
  ): 'ACTIVE' | 'USED' | 'NONE' {
    const matches = (v: string | null): boolean => !!v && values.includes(v);
    if (deliveryEvents.some((d) => matches(d.qrValue) || matches(d.boxQr))) return 'USED';
    const own = movementEvents.filter((m) => matches(m.qrValue) || matches(m.boxQr));
    if (own.length === 0) return 'NONE';
    const latest = own[own.length - 1]; // repository orders oldest-first
    return EXIT_TYPES.has(latest.type) ? 'USED' : 'ACTIVE';
  }

  // ---------------------------------------------------------------------------
  // S5 — trace
  // ---------------------------------------------------------------------------

  async trace(tenantId: string, rawCode: string): Promise<InvQrTraceResponse> {
    const { code, candidates } = normalizeQrInput(rawCode);

    const [registry, unitRows, boxRows] = await Promise.all([
      this.repository.findRegistryByValues(tenantId, candidates),
      this.repository.findUnitsByQrValues(tenantId, candidates),
      this.repository.findBoxesByQrValues(tenantId, candidates),
    ]);

    const box = boxRows[0] ?? null;
    const unit = unitRows[0] ?? null;
    const registryRow: InvQrRegistryRow | null = registry[0] ?? null;
    if (!box && !unit && !registryRow) {
      throw new NotFoundError(`QR ${code} not found`);
    }

    if (box || registryRow?.kind === 'BOX') {
      return this.traceBox(tenantId, code, candidates, box);
    }
    return this.traceUnit(tenantId, code, candidates, unit, registryRow);
  }

  private async traceUnit(
    tenantId: string,
    code: string,
    candidates: string[],
    unit: UnitWithHomologationRow | null,
    registryRow: InvQrRegistryRow | null,
  ): Promise<InvQrTraceResponse> {
    const timeline: InvQrTraceEvent[] = [];
    const boxQr = unit?.homologation.boxQr ?? null;
    const values = [...candidates, ...(boxQr ? [boxQr] : [])];

    if (unit) {
      timeline.push({
        ts: toIso(unit.unit.createdAt ?? unit.homologation.createdAt),
        type: 'HOMOLOGACAO',
        actor: unit.homologation.responsibleId ?? unit.homologation.createdBy ?? null,
        location: 'ALMOXARIFADO',
        refs: {
          homologationId: unit.homologation.id,
          itemId: unit.homologation.itemId,
          releaseId: unit.homologation.releaseId,
          boxQr,
          boxSize: unit.homologation.boxSize,
          position: unit.unit.position,
        },
      });
    } else if (registryRow) {
      // Registry-only identity (e.g. generated but not yet homologated).
      timeline.push({
        ts: toIso(registryRow.createdAt),
        type: 'REGISTRO',
        actor: registryRow.createdBy ?? null,
        location: null,
        refs: { itemId: registryRow.itemId, kind: registryRow.kind },
      });
    }

    const [movementEvents, deliveryEvents] = await Promise.all([
      this.repository.movementEventsByQrs(tenantId, values),
      this.repository.deliveryEventsByQrs(tenantId, values),
    ]);
    this.pushLedgerEvents(timeline, movementEvents, candidates);
    this.pushDeliveryEvents(timeline, deliveryEvents);

    timeline.sort((a, b) => a.ts.localeCompare(b.ts));

    return {
      code,
      current: this.currentState(movementEvents, deliveryEvents),
      isBox: false,
      timeline,
    };
  }

  private async traceBox(
    tenantId: string,
    code: string,
    candidates: string[],
    box: InvHomologationRow | null,
  ): Promise<InvQrTraceResponse> {
    const timeline: InvQrTraceEvent[] = [];
    const units = box ? await this.repository.unitsByHomologationIds(tenantId, [box.id]) : [];

    if (box) {
      timeline.push({
        ts: toIso(box.createdAt),
        type: 'HOMOLOGACAO',
        actor: box.responsibleId ?? box.createdBy ?? null,
        location: 'ALMOXARIFADO',
        refs: {
          homologationId: box.id,
          itemId: box.itemId,
          releaseId: box.releaseId,
          boxSize: box.boxSize,
          unitCount: units.length,
        },
      });
    }

    const [movementEvents, deliveryEvents] = await Promise.all([
      this.repository.movementEventsByQrs(tenantId, candidates),
      this.repository.deliveryEventsByQrs(tenantId, candidates),
    ]);
    this.pushLedgerEvents(timeline, movementEvents, candidates);
    this.pushDeliveryEvents(timeline, deliveryEvents);

    timeline.sort((a, b) => a.ts.localeCompare(b.ts));

    return {
      code,
      current: this.currentState(movementEvents, deliveryEvents),
      isBox: true,
      units: units.map((u) => u.qrValue),
      timeline,
    };
  }

  private pushLedgerEvents(
    timeline: InvQrTraceEvent[],
    events: QrMovementEventRow[],
    ownCandidates: string[],
  ): void {
    for (const m of events) {
      timeline.push({
        ts: toIso(m.createdAt),
        type: EXIT_TYPES.has(m.type) ? 'SAIDA_ESTOQUE' : m.type === 'AJUSTE' ? 'AJUSTE_ESTOQUE' : 'ENTRADA_ESTOQUE',
        actor: m.responsible ?? m.createdBy ?? null,
        location: m.location,
        refs: {
          movementId: m.movementId,
          movementType: m.type,
          reason: m.reason,
          // Box membership: event reached this QR through its box's QR.
          ...(m.boxQr && !ownCandidates.includes(m.qrValue ?? '') ? { viaBoxQr: m.boxQr } : {}),
        },
      });
    }
  }

  private pushDeliveryEvents(timeline: InvQrTraceEvent[], events: QrDeliveryEventRow[]): void {
    for (const d of events) {
      timeline.push({
        ts: toIso(d.createdAt ?? new Date(0)),
        type: 'EXPEDICAO_BAIXA',
        actor: d.createdBy ?? null,
        location: null,
        refs: {
          deliveryId: d.deliveryId,
          orderItemId: d.orderItemId,
          orderId: d.orderId,
          orderTitle: d.orderTitle,
          orderStatus: d.orderStatus,
        },
      });
    }
  }

  /** Current-state header (S5): where the QR is now, derived from its history. */
  private currentState(
    movementEvents: QrMovementEventRow[],
    deliveryEvents: QrDeliveryEventRow[],
  ): InvQrTraceResponse['current'] {
    const lastDelivery = deliveryEvents[deliveryEvents.length - 1] ?? null;
    const lastMovement = movementEvents[movementEvents.length - 1] ?? null;

    const deliveryTs = lastDelivery?.createdAt ? new Date(lastDelivery.createdAt).getTime() : null;
    const movementTs = lastMovement?.createdAt ? new Date(lastMovement.createdAt).getTime() : null;

    if (lastDelivery && (movementTs === null || (deliveryTs !== null && deliveryTs >= movementTs))) {
      return {
        location: 'EXPEDICAO',
        status: lastDelivery.orderStatus ?? 'EXPEDIDO',
        client: lastDelivery.orderTitle ?? null,
      };
    }
    if (lastMovement) {
      if (EXIT_TYPES.has(lastMovement.type)) {
        return { location: null, status: 'BAIXADO', client: null };
      }
      return { location: lastMovement.location, status: 'EM_ESTOQUE', client: null };
    }
    return { location: 'ALMOXARIFADO', status: 'HOMOLOGADO', client: null };
  }
}

function toIso(value: Date | string | null | undefined): string {
  return value ? new Date(value).toISOString() : new Date(0).toISOString();
}

export const inventoryQrService = new InventoryQrService();
