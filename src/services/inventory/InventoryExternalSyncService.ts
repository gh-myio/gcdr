// =============================================================================
// RFC-0061 M8 — External pull sync (source semantics preserved, §M8).
//
// One run =
//   1. single-flight LEASE (3 min) persisted in inv_external_sync_state —
//      an atomic upsert claim; a held lease → ConflictError (409 on the manual
//      trigger, silent skip on the cron). 1000-item cap per execution.
//   2. GET the full platform list. GOLDEN RULE: only codes whose QR exists in
//      inv_qr_registry / inv_homologation_units are considered; everything
//      else is ignored (counted). Mirror rows whose code is no longer eligible
//      are deleted (orphans).
//   3. BOX-IS-MASTER (2 passes): pass 1 — a state reported for a BOX QR
//      propagates to every unit inside the box; pass 2 — a unit reported at
//      the client (location `cliente` or status `instalado`) "leaves the box":
//      it becomes its own box_size=1 homologation (M5 repos), an emptied box
//      is deleted and its box-QR identity released.
//   4. Mirror upsert into inv_external_states (raw payload kept;
//      last_change_at only bumped when the observable state changed).
//   5. LEDGER RECONCILIATION — auto-corrections with an app-level guard:
//      product in the field but its QR still "in stock" (latest ledger event
//      is an entry) ⇒ SAIDA of 1un (responsible = technician when the platform
//      says `tecnico`; skipped with a problem when the balance would go
//      negative); back to `estoque` while the ledger says exited ⇒ compensating
//      ENTRADA with the QR re-linked to the new movement (so the next run
//      doesn't undo it). A QR that left a technician's custody also consumes
//      the open dispatch via inv_technician_moves ("zera a lista do técnico").
//   6. Order auto-transition: EM_TRANSITO orders whose delivered QRs ALL read
//      `cliente` ⇒ ENTREGUE_CLIENTE + unit-product vínculo (runs BEFORE the
//      generic client upsert so those units keep the expedition link).
//   7. `cliente` ⇒ upsert inv_unit_products (INSTALADO/PARADO; client matched
//      to inv_projects case-insensitively — "Projeto = Cliente"); a unit that
//      left the client ⇒ moved_to per the location map.
//   8. `avariado` ⇒ inv_damaged_items (at most ONE open report per code).
//   9. Run report {ok, total, ignored, changed, corrections, problems[]}
//      persisted in inv_external_sync_state (status OK|PARCIAL|ERRO).
//
// SHADOW MODE (J4 — the default): steps 1–4 and 9 always run for real (the
// mirror is observability, not state); steps 5–8 are COMPUTED AND LOGGED ONLY
// — each would-be correction lands in the run report (persisted as JSON in
// inv_external_sync_state.last_message — the "simple choice": no extra log
// table; weeks of shadow diffs live in the report history + stdout) and is
// NOT applied. Real writes require env INV_SYNC_LIVE=true; the manual trigger
// additionally accepts ?live=true only when that env is set.
//
// Drizzle gotcha: DrizzleQueryError wraps the real SQLSTATE/message in
// `err.cause` — `errMessage()` unwraps it before recording problems.
// =============================================================================

import { z } from 'zod';
import {
  InventoryExternalRepository,
  inventoryExternalRepository,
  InvExternalStateRow,
  InvExternalSyncStateRow,
  OutboxCounters,
  ExternalStateListFilters,
  DispatchByQrRow,
  InvProjectRow,
  InvUnitProductRow,
} from '../../repositories/inventory/InventoryExternalRepository';
import {
  InventoryHomologationRepository,
  inventoryHomologationRepository,
  InvQrRegistryRow,
  UnitWithHomologationRow,
} from '../../repositories/inventory/InventoryHomologationRepository';
import {
  InventoryStockRepository,
  inventoryStockRepository,
} from '../../repositories/inventory/InventoryStockRepository';
import {
  InventoryFieldRepository,
  inventoryFieldRepository,
} from '../../repositories/inventory/InventoryFieldRepository';
import {
  InventoryExpeditionRepository,
  inventoryExpeditionRepository,
} from '../../repositories/inventory/InventoryExpeditionRepository';
import {
  ExternalPlatformClient,
  ExternalProduct,
  externalPlatformClientFromEnv,
  externalNotConfigured,
} from './ExternalPlatformClient';
import { normalizeQrInput } from './InventoryQrService';
import { QR_BASE_URL } from './InventoryHomologationService';
import { ConflictError, ValidationError } from '../../shared/errors/AppError';
import type { InvPaginatedResponse } from '../../dto/response/InventoryResponseDTO';

// -----------------------------------------------------------------------------
// Tuning
// -----------------------------------------------------------------------------

export const SYNC_LEASE_MS = 3 * 60_000; // single-flight lease (§M8)
export const SYNC_ITEM_CAP = 1000; // per-execution cap (§M8)
/** Ledger corrections act on the warehouse (homologation entry location). */
export const SYNC_STOCK_LOCATION = 'ALMOXARIFADO';
/** Corrections kept verbatim in the persisted report (the rest is counted). */
const REPORT_CORRECTIONS_CAP = 200;

const EXIT_TYPES = new Set(['SAIDA', 'TRANSFERENCIA_OUT']);

/** external location → inv_unit_products.moved_to / technician destination. */
const LOCATION_TO_MOVED_TO: Record<string, string> = {
  tecnico: 'TECNICO',
  estoque: 'ALMOXARIFADO',
  perdido: 'PERDIDO',
  avariado: 'AVARIADO',
};
const LOCATION_TO_TECH_DESTINATION: Record<string, string> = {
  cliente: 'UNIDADE',
  estoque: 'ALMOXARIFADO',
  perdido: 'PERDIDO',
  avariado: 'AVARIADO',
};

/** A QR code embedded in free text (damage dedup — same regex as M7). */
const EMBEDDED_QR_REGEX = /\d+(?:_\d+)+/;

export function isSyncLiveEnabled(): boolean {
  return process.env.INV_SYNC_LIVE === 'true';
}

// -----------------------------------------------------------------------------
// Request DTOs (M8 — finalized at implementation time; src/dto frozen for this
// PR, same module-boundary note as M5/M7)
// -----------------------------------------------------------------------------

export const ExternalStatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  location: z.string().min(1).max(50).optional(),
  status: z.string().min(1).max(50).optional(),
  q: z.string().min(1).max(100).optional(),
});
export type ExternalStatesQuery = z.infer<typeof ExternalStatesQuerySchema>;

export const SyncRunQuerySchema = z.object({
  live: z.enum(['true', 'false']).optional(),
});
export type SyncRunQuery = z.infer<typeof SyncRunQuerySchema>;

export const GenerateQrSchema = z
  .object({ productType: z.string().min(1).max(200) })
  .strict();
export type GenerateQrDTO = z.infer<typeof GenerateQrSchema>;

// -----------------------------------------------------------------------------
// Report shapes
// -----------------------------------------------------------------------------

export type SyncCorrectionKind =
  | 'BOX_UNIT_LEFT_BOX'
  | 'LEDGER_SAIDA'
  | 'LEDGER_ENTRADA'
  | 'TECHNICIAN_MOVE'
  | 'UNIT_CREATED'
  | 'UNIT_STATUS'
  | 'UNIT_MOVED_OUT'
  | 'DAMAGED_REPORT'
  | 'ORDER_DELIVERED';

export interface SyncCorrection {
  kind: SyncCorrectionKind;
  code: string;
  detail: string;
  /** false in shadow mode — the correction was only computed and logged. */
  applied: boolean;
}

export interface SyncRunReport {
  ok: boolean;
  live: boolean;
  total: number;
  ignored: number;
  changed: number;
  orphansDeleted: number;
  corrections: SyncCorrection[];
  problems: string[];
}

export interface ExternalSyncStatusResponse {
  syncState: {
    tenantId: string;
    leaseUntil: string | null;
    leaseActive: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastMessage: string | null;
    totalItems: number | null;
  } | null;
  outbox: OutboxCounters;
  mode: { live: boolean; shadow: boolean };
}

export interface InvExternalStateResponse {
  id: string;
  code: string;
  productType: string | null;
  location: string | null;
  status: string | null;
  technician: string | null;
  clientName: string | null;
  qrValue: string | null;
  itemId: string | null;
  homologationUnitId: string | null;
  lastChangeAt: string | null;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Repository seams (Pick — tests inject jest mocks)
// -----------------------------------------------------------------------------

export type IExternalSyncRepository = Pick<
  InventoryExternalRepository,
  | 'listStates'
  | 'allStates'
  | 'upsertState'
  | 'deleteStatesNotIn'
  | 'claimLease'
  | 'releaseLease'
  | 'getSyncState'
  | 'outboxCounters'
  | 'unitProductsByLabels'
  | 'projectsByNamesInsensitive'
  | 'dispatchesByQrValues'
  | 'listOpenDamaged'
  | 'ordersInTransit'
>;

export type IExternalHomologRepository = Pick<
  InventoryHomologationRepository,
  | 'withTransaction'
  | 'findRegistryByValues'
  | 'findUnitsByQrValues'
  | 'findBoxesByQrValues'
  | 'unitsByHomologationIds'
  | 'insertHomologation'
  | 'moveUnit'
  | 'countUnits'
  | 'deleteHomologation'
  | 'deleteRegistryByValues'
>;

export type IExternalStockRepository = Pick<
  InventoryStockRepository,
  'withTransaction' | 'lockItem' | 'getBalance' | 'insertMovement' | 'insertMovementQrs' | 'latestQrEventTypes'
>;

export type IExternalFieldRepository = Pick<
  InventoryFieldRepository,
  'insertUnitProducts' | 'updateUnitStatus' | 'markUnitMoved' | 'insertTechnicianMove' | 'insertDamagedItem'
>;

export type IExternalExpeditionRepository = Pick<
  InventoryExpeditionRepository,
  'withTransaction' | 'deliveredQrsByOrder' | 'updateOrder' | 'existingUnitProductLabels' | 'insertUnitProducts' | 'getProject'
>;

export interface InventoryExternalSyncDeps {
  repository?: IExternalSyncRepository;
  homologRepository?: IExternalHomologRepository;
  stockRepository?: IExternalStockRepository;
  fieldRepository?: IExternalFieldRepository;
  expeditionRepository?: IExternalExpeditionRepository;
  /** Client provider — null means "not configured" (503 / cron skip). */
  clientProvider?: () => ExternalPlatformClient | null;
  now?: () => Date;
}

// -----------------------------------------------------------------------------
// Internal working shape — one per eligible code after box propagation
// -----------------------------------------------------------------------------

interface EffectiveState {
  /** Bare code (`\d+(_\d+)+` for units; box QRs keep their scanned value). */
  code: string;
  candidates: string[];
  location: string | null;
  status: string | null;
  technician: string | null;
  clientName: string | null;
  productType: string | null;
  changedAt: string | null;
  payload: unknown;
  registry: InvQrRegistryRow | null;
  unit: UnitWithHomologationRow | null;
  isBox: boolean;
}

/** Unwrap DrizzleQueryError — real SQLSTATE/message live in err.cause. */
function errMessage(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  if (cause instanceof Error && cause.message) return cause.message;
  return err instanceof Error ? err.message : String(err);
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// =============================================================================
// Service
// =============================================================================

export class InventoryExternalSyncService {
  private repository: IExternalSyncRepository;
  private homologRepository: IExternalHomologRepository;
  private stockRepository: IExternalStockRepository;
  private fieldRepository: IExternalFieldRepository;
  private expeditionRepository: IExternalExpeditionRepository;
  private clientProvider: () => ExternalPlatformClient | null;
  private now: () => Date;

  constructor(deps: InventoryExternalSyncDeps = {}) {
    this.repository = deps.repository ?? inventoryExternalRepository;
    this.homologRepository = deps.homologRepository ?? inventoryHomologationRepository;
    this.stockRepository = deps.stockRepository ?? inventoryStockRepository;
    this.fieldRepository = deps.fieldRepository ?? inventoryFieldRepository;
    this.expeditionRepository = deps.expeditionRepository ?? inventoryExpeditionRepository;
    this.clientProvider = deps.clientProvider ?? externalPlatformClientFromEnv;
    this.now = deps.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------------------
  // Read endpoints
  // ---------------------------------------------------------------------------

  async listStates(tenantId: string, query: ExternalStatesQuery): Promise<InvPaginatedResponse<InvExternalStateResponse>> {
    const filters: ExternalStateListFilters = {
      page: query.page,
      pageSize: query.pageSize,
      location: query.location,
      status: query.status,
      q: query.q,
    };
    const { rows, total } = await this.repository.listStates(tenantId, filters);
    return {
      items: rows.map((r) => this.toStateResponse(r)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getStatus(tenantId: string): Promise<ExternalSyncStatusResponse> {
    const [state, outbox] = await Promise.all([
      this.repository.getSyncState(tenantId),
      this.repository.outboxCounters(tenantId),
    ]);
    const live = isSyncLiveEnabled();
    return {
      syncState: state ? this.toSyncStateResponse(state) : null,
      outbox,
      mode: { live, shadow: !live },
    };
  }

  // ---------------------------------------------------------------------------
  // QR generation (POST /qr/generate — delegates to the platform, DEC-7)
  // ---------------------------------------------------------------------------

  async generateQr(dto: GenerateQrDTO): Promise<{ code: string; qrUrl: string }> {
    const client = this.clientProvider();
    if (!client) throw externalNotConfigured();
    const product = await client.createProduct({
      product_type: dto.productType,
      location: 'estoque',
      status: 'parado',
    });
    return { code: product.code, qrUrl: `${QR_BASE_URL}${product.code}` };
  }

  // ---------------------------------------------------------------------------
  // Pull run
  // ---------------------------------------------------------------------------

  /**
   * One pull execution. `opts.live` (manual ?live=true) requires
   * INV_SYNC_LIVE=true; without opts the mode follows the env (cron path).
   * Throws ConflictError (409) when another runner holds the lease.
   */
  async runPull(tenantId: string, opts: { live?: boolean } = {}): Promise<SyncRunReport> {
    const client = this.clientProvider();
    if (!client) throw externalNotConfigured();

    const liveEnv = isSyncLiveEnabled();
    if (opts.live === true && !liveEnv) {
      throw new ValidationError('live=true requer INV_SYNC_LIVE=true no ambiente (J4 — shadow first)');
    }
    const live = opts.live ?? liveEnv;

    const lease = await this.repository.claimLease(tenantId, SYNC_LEASE_MS);
    if (!lease) {
      throw new ConflictError('Sincronização externa já em execução (lease ativo)');
    }

    const report: SyncRunReport = {
      ok: true,
      live,
      total: 0,
      ignored: 0,
      changed: 0,
      orphansDeleted: 0,
      corrections: [],
      problems: [],
    };

    try {
      let products: ExternalProduct[];
      try {
        products = await client.listProducts();
      } catch (err) {
        report.ok = false;
        report.problems.push(`Falha ao consultar a plataforma externa: ${errMessage(err)}`);
        return report;
      }

      report.total = products.length;
      if (products.length > SYNC_ITEM_CAP) {
        report.problems.push(
          `Plataforma retornou ${products.length} itens; processando apenas ${SYNC_ITEM_CAP} (cap por execução)`,
        );
        products = products.slice(0, SYNC_ITEM_CAP);
      }

      // Golden rule + box-is-master → the effective per-code state map.
      const effective = await this.buildEffectiveStates(tenantId, products, report);

      // Pass 2 of box-is-master: a unit at the client leaves its box.
      await this.applyBoxExits(tenantId, effective, live, report);

      // Mirror upsert (always applied — shadow included) + orphan cleanup.
      await this.upsertMirror(tenantId, effective, report);

      // Ledger reconciliation + technician zeroing (shadow-gated).
      await this.reconcileLedger(tenantId, effective, live, report);

      // Order auto-transition BEFORE the generic client upsert (keeps vínculo).
      await this.autoDeliverOrders(tenantId, effective, live, report);

      // Client unit products (upsert + moved-out) — shadow-gated.
      await this.reconcileClientUnits(tenantId, effective, live, report);

      // Damaged auto-report — shadow-gated.
      await this.reportDamaged(tenantId, effective, live, report);

      return report;
    } catch (err) {
      report.ok = false;
      report.problems.push(`Erro inesperado no sync: ${errMessage(err)}`);
      return report;
    } finally {
      await this.persistReport(tenantId, report);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2/3a — golden rule + box propagation (pass 1)
  // ---------------------------------------------------------------------------

  private async buildEffectiveStates(
    tenantId: string,
    products: ExternalProduct[],
    report: SyncRunReport,
  ): Promise<Map<string, EffectiveState>> {
    const allCandidates = new Set<string>();
    const normalized = products.map((p) => {
      const n = normalizeQrInput(p.code);
      n.candidates.forEach((c) => allCandidates.add(c));
      return { product: p, code: n.code, candidates: n.candidates };
    });

    const registryRows = await this.homologRepository.findRegistryByValues(tenantId, [...allCandidates]);
    const registryByValue = new Map(registryRows.map((r) => [r.qrValue, r]));

    const unitRows = await this.homologRepository.findUnitsByQrValues(tenantId, [...allCandidates]);
    const unitByValue = new Map(unitRows.map((u) => [u.unit.qrValue, u]));

    const effective = new Map<string, EffectiveState>();

    for (const { product, code, candidates } of normalized) {
      const registry = candidates.map((c) => registryByValue.get(c)).find((r) => r) ?? null;
      const unit = candidates.map((c) => unitByValue.get(c)).find((u) => u) ?? null;
      if (!registry && !unit) {
        // GOLDEN RULE: not homologated in GCDR — ignored.
        report.ignored += 1;
        continue;
      }
      effective.set(code, {
        code,
        candidates,
        location: product.location,
        status: product.status,
        technician: product.technician,
        clientName: product.clientName,
        productType: product.productType,
        changedAt: product.changedAt,
        payload: product.raw,
        registry,
        unit,
        isBox: registry?.kind === 'BOX',
      });
    }

    // BOX-IS-MASTER pass 1: box state overwrites its units' state.
    const boxStates = [...effective.values()].filter((s) => s.isBox);
    if (boxStates.length > 0) {
      const boxCandidates = boxStates.flatMap((s) => s.candidates);
      const boxes = await this.homologRepository.findBoxesByQrValues(tenantId, boxCandidates);
      const boxByValue = new Map(boxes.filter((b) => b.boxQr).map((b) => [b.boxQr as string, b]));
      const boxIds = boxes.map((b) => b.id);
      const units = await this.homologRepository.unitsByHomologationIds(tenantId, boxIds);
      const unitsByHomologation = new Map<string, typeof units>();
      for (const u of units) {
        const list = unitsByHomologation.get(u.homologationId) ?? [];
        list.push(u);
        unitsByHomologation.set(u.homologationId, list);
      }

      for (const boxState of boxStates) {
        const box = boxState.candidates.map((c) => boxByValue.get(c)).find((b) => b);
        if (!box) continue;
        for (const u of unitsByHomologation.get(box.id) ?? []) {
          const n = normalizeQrInput(u.qrValue);
          const existing = effective.get(n.code);
          const propagated: EffectiveState = {
            code: n.code,
            candidates: existing?.candidates ?? n.candidates,
            location: boxState.location,
            status: boxState.status,
            technician: boxState.technician,
            clientName: boxState.clientName,
            productType: existing?.productType ?? boxState.productType,
            changedAt: boxState.changedAt,
            payload: existing?.payload ?? boxState.payload,
            registry: existing?.registry ?? null,
            unit: existing?.unit ?? { unit: u, homologation: box },
            isBox: false,
          };
          effective.set(n.code, propagated);
        }
      }
    }

    return effective;
  }

  // ---------------------------------------------------------------------------
  // Step 3b — box-is-master pass 2: unit at the client leaves its box
  // ---------------------------------------------------------------------------

  private async applyBoxExits(
    tenantId: string,
    effective: Map<string, EffectiveState>,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    for (const state of effective.values()) {
      if (state.isBox || !state.unit) continue;
      const { homologation } = state.unit;
      if (homologation.boxSize <= 1) continue;
      const atClient = state.location === 'cliente' || state.status === 'instalado';
      if (!atClient) continue;

      const correction: SyncCorrection = {
        kind: 'BOX_UNIT_LEFT_BOX',
        code: state.code,
        detail: `Unidade em cliente/instalado sai da caixa ${homologation.boxQr ?? homologation.id} (avulsa box_size=1)`,
        applied: false,
      };
      if (live) {
        try {
          await this.homologRepository.withTransaction(async (tx) => {
            const solo = await this.homologRepository.insertHomologation(
              {
                tenantId,
                itemId: homologation.itemId,
                releaseId: homologation.releaseId,
                boxSize: 1,
                boxQr: null,
                responsibleId: homologation.responsibleId,
                notes: homologation.notes,
                createdBy: null,
              },
              tx,
            );
            await this.homologRepository.moveUnit(tenantId, state.unit!.unit.id, solo.id, 1, tx);
            const left = await this.homologRepository.countUnits(homologation.id, tx);
            if (left === 0) {
              await this.homologRepository.deleteHomologation(tenantId, homologation.id, tx);
              if (homologation.boxQr) {
                await this.homologRepository.deleteRegistryByValues(tenantId, [homologation.boxQr], tx);
              }
            }
          });
          correction.applied = true;
        } catch (err) {
          report.problems.push(`Saída da caixa falhou para ${state.code}: ${errMessage(err)}`);
        }
      }
      report.corrections.push(correction);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 4 — mirror upsert + orphan cleanup (always applied, shadow included)
  // ---------------------------------------------------------------------------

  private async upsertMirror(
    tenantId: string,
    effective: Map<string, EffectiveState>,
    report: SyncRunReport,
  ): Promise<void> {
    const existingRows = await this.repository.allStates(tenantId);
    const existingByCode = new Map(existingRows.map((r) => [r.code, r]));

    for (const state of effective.values()) {
      const existing = existingByCode.get(state.code);
      const changed =
        !existing ||
        existing.location !== state.location ||
        existing.status !== state.status ||
        existing.technician !== state.technician ||
        existing.clientName !== state.clientName ||
        existing.productType !== state.productType;
      if (changed) report.changed += 1;

      try {
        await this.repository.upsertState({
          tenantId,
          code: state.code,
          productType: state.productType,
          location: state.location,
          status: state.status,
          technician: state.technician,
          clientName: state.clientName,
          qrValue: state.unit?.unit.qrValue ?? state.registry?.qrValue ?? state.code,
          itemId: state.registry?.itemId ?? state.unit?.homologation.itemId ?? null,
          homologationUnitId: state.unit?.unit.id ?? null,
          // last_change_at only bumps when the observable state changed.
          lastChangeAt: changed ? this.now() : existing?.lastChangeAt ?? null,
          payload: state.payload,
        });
      } catch (err) {
        report.problems.push(`Upsert do mirror falhou para ${state.code}: ${errMessage(err)}`);
      }
    }

    try {
      report.orphansDeleted = await this.repository.deleteStatesNotIn(tenantId, [...effective.keys()]);
    } catch (err) {
      report.problems.push(`Limpeza de órfãos do mirror falhou: ${errMessage(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 5 — ledger reconciliation + technician zeroing (shadow-gated)
  // ---------------------------------------------------------------------------

  private async reconcileLedger(
    tenantId: string,
    effective: Map<string, EffectiveState>,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    const unitStates = [...effective.values()].filter((s) => !s.isBox);
    if (unitStates.length === 0) return;

    const allCandidates = unitStates.flatMap((s) => s.candidates);
    const latestByQr = await this.stockRepository.latestQrEventTypes(tenantId, allCandidates);
    const dispatches = await this.repository.dispatchesByQrValues(tenantId, allCandidates);
    // Newest-first from the repo — first hit per QR wins.
    const dispatchByQr = new Map<string, (typeof dispatches)[number]>();
    for (const d of dispatches) {
      if (!dispatchByQr.has(d.qrValue)) dispatchByQr.set(d.qrValue, d);
    }

    for (const state of unitStates) {
      const latest = state.candidates.map((c) => latestByQr.get(c)).find((t) => t !== undefined);
      if (latest === undefined) continue; // QR never touched the ledger — nothing to reconcile
      const inStock = !EXIT_TYPES.has(latest);
      const itemId = state.registry?.itemId ?? state.unit?.homologation.itemId ?? null;
      const qrValue = state.unit?.unit.qrValue ?? state.registry?.qrValue ?? state.code;

      if (state.location !== null && state.location !== 'estoque' && inStock) {
        // In the field per the platform, still in stock per the ledger ⇒ SAIDA.
        await this.applyLedgerExit(tenantId, state, itemId, qrValue, live, report);
      } else if (state.location === 'estoque' && !inStock) {
        // Back in stock per the platform, exited per the ledger ⇒ ENTRADA.
        await this.applyLedgerReturn(tenantId, state, itemId, qrValue, live, report);
      }

      // Technician zeroing: the QR left the technician's custody.
      await this.zeroTechnicianCustody(tenantId, state, dispatchByQr, live, report);
    }
  }

  private async zeroTechnicianCustody(
    tenantId: string,
    state: EffectiveState,
    dispatchByQr: Map<string, DispatchByQrRow>,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    if (state.location === null || state.location === 'tecnico') return;
    const dispatch = state.candidates.map((c) => dispatchByQr.get(c)).find((d) => d);
    const destination = LOCATION_TO_TECH_DESTINATION[state.location];
    if (!dispatch || !destination || Number(dispatch.quantity) - dispatch.movedQuantity <= 0) return;

    const correction: SyncCorrection = {
      kind: 'TECHNICIAN_MOVE',
      code: state.code,
      detail: `Zera custódia do técnico ${dispatch.technician} → ${destination} (1un)`,
      applied: false,
    };
    if (live) {
      try {
        await this.fieldRepository.insertTechnicianMove({
          tenantId,
          movementId: dispatch.movementId,
          itemId: dispatch.itemId,
          technician: dispatch.technician,
          destination,
          quantity: 1,
          notes: `Sincronização externa — ${state.code} em ${state.location}`,
        });
        correction.applied = true;
      } catch (err) {
        report.problems.push(`Baixa de custódia do técnico falhou para ${state.code}: ${errMessage(err)}`);
      }
    }
    report.corrections.push(correction);
  }

  private async applyLedgerExit(
    tenantId: string,
    state: EffectiveState,
    itemId: string | null,
    qrValue: string,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    if (!itemId) {
      report.problems.push(`Correção SAIDA impossível para ${state.code}: item desconhecido`);
      return;
    }
    const correction: SyncCorrection = {
      kind: 'LEDGER_SAIDA',
      code: state.code,
      detail: `SAIDA 1un de ${SYNC_STOCK_LOCATION} (plataforma reporta ${state.location})`,
      applied: false,
    };
    if (live) {
      try {
        await this.stockRepository.withTransaction(async (tx) => {
          await this.stockRepository.lockItem(tenantId, itemId, tx);
          const balance = await this.stockRepository.getBalance(tenantId, itemId, SYNC_STOCK_LOCATION, tx);
          if (Number(balance.balance) < 1) {
            // App-level negative guard: never drive the ledger negative.
            throw new Error(`saldo insuficiente (${balance.balance}) em ${SYNC_STOCK_LOCATION}`);
          }
          const movement = await this.stockRepository.insertMovement(
            {
              tenantId,
              itemId,
              location: SYNC_STOCK_LOCATION,
              quantity: '1',
              type: 'SAIDA',
              reason: `Sincronização externa — ${state.code} em ${state.location}`,
              responsible: state.location === 'tecnico' ? state.technician ?? null : null,
            },
            tx,
          );
          await this.stockRepository.insertMovementQrs(
            tenantId,
            movement.id,
            [{ qrValue, homologationUnitId: state.unit?.unit.id }],
            tx,
          );
        });
        correction.applied = true;
      } catch (err) {
        report.problems.push(`Correção SAIDA falhou para ${state.code}: ${errMessage(err)}`);
      }
    }
    report.corrections.push(correction);
  }

  private async applyLedgerReturn(
    tenantId: string,
    state: EffectiveState,
    itemId: string | null,
    qrValue: string,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    if (!itemId) {
      report.problems.push(`Correção ENTRADA impossível para ${state.code}: item desconhecido`);
      return;
    }
    const correction: SyncCorrection = {
      kind: 'LEDGER_ENTRADA',
      code: state.code,
      detail: `ENTRADA de estorno 1un em ${SYNC_STOCK_LOCATION} (plataforma reporta estoque)`,
      applied: false,
    };
    if (live) {
      try {
        await this.stockRepository.withTransaction(async (tx) => {
          await this.stockRepository.lockItem(tenantId, itemId, tx);
          const movement = await this.stockRepository.insertMovement(
            {
              tenantId,
              itemId,
              location: SYNC_STOCK_LOCATION,
              quantity: '1',
              type: 'ENTRADA',
              reason: `Sincronização externa — retorno ao estoque (${state.code})`,
            },
            tx,
          );
          // Re-link the QR so the NEXT run sees it "in stock" (anti-loop).
          await this.stockRepository.insertMovementQrs(
            tenantId,
            movement.id,
            [{ qrValue, homologationUnitId: state.unit?.unit.id }],
            tx,
          );
        });
        correction.applied = true;
      } catch (err) {
        report.problems.push(`Correção ENTRADA falhou para ${state.code}: ${errMessage(err)}`);
      }
    }
    report.corrections.push(correction);
  }

  // ---------------------------------------------------------------------------
  // Step 6 — EM_TRANSITO orders fully at the client ⇒ ENTREGUE_CLIENTE
  // ---------------------------------------------------------------------------

  private async autoDeliverOrders(
    tenantId: string,
    effective: Map<string, EffectiveState>,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    let orders;
    try {
      orders = await this.repository.ordersInTransit(tenantId);
    } catch (err) {
      report.problems.push(`Consulta de pedidos em trânsito falhou: ${errMessage(err)}`);
      return;
    }

    for (const order of orders) {
      try {
        const allQrs = await this.expeditionRepository.deliveredQrsByOrder(tenantId, order.id);
        const qrs = allQrs
          .filter((q) => q.qrValue !== null)
          .map((q) => ({ qrValue: q.qrValue as string, itemId: q.itemId }));
        if (qrs.length === 0) continue;
        const allAtClient = qrs.every((q) => {
          const state = effective.get(normalizeQrInput(q.qrValue).code);
          return state?.location === 'cliente';
        });
        if (!allAtClient) continue;

        const correction: SyncCorrection = {
          kind: 'ORDER_DELIVERED',
          code: order.id,
          detail: `Pedido ${order.title ?? order.id}: todos os ${qrs.length} QRs em cliente ⇒ ENTREGUE_CLIENTE`,
          applied: false,
        };
        if (live) {
          await this.expeditionRepository.withTransaction(async (tx) => {
            await this.expeditionRepository.updateOrder(tenantId, order.id, { status: 'ENTREGUE_CLIENTE' }, tx);
            // Vínculo: one unit product per delivered QR (idempotent by label).
            const project = order.projectId
              ? await this.expeditionRepository.getProject(tenantId, order.projectId, tx)
              : null;
            const labels = [...new Set(qrs.map((q) => q.qrValue))];
            const existing = await this.expeditionRepository.existingUnitProductLabels(tenantId, labels, tx);
            const byLabel = new Map(qrs.map((q) => [q.qrValue, q]));
            await this.expeditionRepository.insertUnitProducts(
              labels
                .filter((l) => !existing.has(l))
                .map((label) => ({
                  tenantId,
                  itemId: byLabel.get(label)?.itemId ?? null,
                  label,
                  projectId: order.projectId,
                  customerId: project?.customerId ?? order.customerId ?? null,
                  clientNameSnapshot: project?.name ?? null,
                  expeditionOrderId: order.id,
                  createdBy: null,
                })),
              tx,
            );
          });
          correction.applied = true;
        }
        report.corrections.push(correction);
      } catch (err) {
        report.problems.push(`Auto-entrega do pedido ${order.id} falhou: ${errMessage(err)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 7 — client unit products (upsert + moved-out), shadow-gated
  // ---------------------------------------------------------------------------

  private async reconcileClientUnits(
    tenantId: string,
    effective: Map<string, EffectiveState>,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    const unitStates = [...effective.values()].filter((s) => !s.isBox);
    if (unitStates.length === 0) return;

    const allCandidates = unitStates.flatMap((s) => s.candidates);
    const unitProducts = await this.repository.unitProductsByLabels(tenantId, allCandidates);
    const unitByLabel = new Map(unitProducts.filter((u) => u.label).map((u) => [u.label as string, u]));

    const clientNames = [
      ...new Set(
        unitStates
          .filter((s) => s.location === 'cliente' && s.clientName)
          .map((s) => (s.clientName as string).toLowerCase()),
      ),
    ];
    const projects = await this.repository.projectsByNamesInsensitive(
      tenantId,
      clientNames,
    );
    const projectByName = new Map(projects.map((p) => [p.name.toLowerCase(), p]));

    for (const state of unitStates) {
      const existing = state.candidates.map((c) => unitByLabel.get(c)).find((u) => u) ?? null;
      if (state.location === 'cliente') {
        await this.upsertClientUnit(tenantId, state, existing, projectByName, live, report);
      } else if (existing && existing.movedTo === null && state.location !== null) {
        await this.markUnitLeftClient(tenantId, state, existing, live, report);
      }
    }
  }

  /** Platform says `cliente`: create the unit product or fix its status. */
  private async upsertClientUnit(
    tenantId: string,
    state: EffectiveState,
    existing: InvUnitProductRow | null,
    projectByName: Map<string, InvProjectRow>,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    const targetStatus = state.status === 'instalado' ? 'INSTALADO' : 'PARADO';
    const project = state.clientName ? projectByName.get(state.clientName.toLowerCase()) ?? null : null;
    if (state.clientName && !project) {
      report.problems.push(
        `Projeto não encontrado para o cliente "${state.clientName}" (${state.code}) — unidade sem vínculo de projeto`,
      );
    }

    if (!existing) {
      await this.recordCorrection(
        report,
        {
          kind: 'UNIT_CREATED',
          code: state.code,
          detail: `Cria unit product ${targetStatus} no cliente ${state.clientName ?? '?'} (projeto ${project?.name ?? '—'})`,
          applied: false,
        },
        live,
        () =>
          this.fieldRepository
            .insertUnitProducts([
              {
                tenantId,
                itemId: state.registry?.itemId ?? state.unit?.homologation.itemId ?? null,
                label: state.unit?.unit.qrValue ?? state.registry?.qrValue ?? state.code,
                status: targetStatus,
                projectId: project?.id ?? null,
                customerId: project?.customerId ?? null,
                clientNameSnapshot: state.clientName ?? project?.name ?? null,
                notes: 'Criado pela sincronização externa',
              },
            ])
            .then(() => undefined),
        `Criação de unit product falhou para ${state.code}`,
      );
      return;
    }

    if (existing.movedTo === null && existing.status !== targetStatus) {
      await this.recordCorrection(
        report,
        {
          kind: 'UNIT_STATUS',
          code: state.code,
          detail: `Status ${existing.status} → ${targetStatus}`,
          applied: false,
        },
        live,
        () =>
          this.fieldRepository
            .updateUnitStatus(tenantId, existing.id, targetStatus, targetStatus === 'INSTALADO' ? this.now() : null)
            .then(() => undefined),
        `Atualização de status falhou para ${state.code}`,
      );
    }
  }

  /** Log the correction; apply it only in live mode (J4 shadow gate). */
  private async recordCorrection(
    report: SyncRunReport,
    correction: SyncCorrection,
    live: boolean,
    apply: () => Promise<void>,
    failurePrefix: string,
  ): Promise<void> {
    if (live) {
      try {
        await apply();
        correction.applied = true;
      } catch (err) {
        report.problems.push(`${failurePrefix}: ${errMessage(err)}`);
      }
    }
    report.corrections.push(correction);
  }

  /** Left the client per the platform ⇒ moved_to (tracking-only, §M7). */
  private async markUnitLeftClient(
    tenantId: string,
    state: EffectiveState,
    existing: InvUnitProductRow,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    const movedTo = LOCATION_TO_MOVED_TO[state.location as string];
    if (!movedTo) return; // expedicao/transporte: in-flight logistics, not a field move
    const technicianSuffix = state.technician ? ` (técnico ${state.technician})` : '';
    const correction: SyncCorrection = {
      kind: 'UNIT_MOVED_OUT',
      code: state.code,
      detail: `Saiu do cliente ⇒ moved_to ${movedTo}${technicianSuffix}`,
      applied: false,
    };
    if (live) {
      try {
        await this.fieldRepository.markUnitMoved(tenantId, existing.id, {
          movedTo,
          movedTechnician: state.technician ?? null,
          movedAt: this.now(),
          moveNotes: `Sincronização externa — ${state.code} em ${state.location}`,
        });
        correction.applied = true;
      } catch (err) {
        report.problems.push(`Baixa do cliente falhou para ${state.code}: ${errMessage(err)}`);
      }
    }
    report.corrections.push(correction);
  }

  // ---------------------------------------------------------------------------
  // Step 8 — damaged auto-report (one open row per code), shadow-gated
  // ---------------------------------------------------------------------------

  private async reportDamaged(
    tenantId: string,
    effective: Map<string, EffectiveState>,
    live: boolean,
    report: SyncRunReport,
  ): Promise<void> {
    const damaged = [...effective.values()].filter((s) => !s.isBox && s.location === 'avariado');
    if (damaged.length === 0) return;

    let openCodes: Set<string>;
    try {
      const openRows = await this.repository.listOpenDamaged(tenantId);
      openCodes = new Set(
        openRows
          .map((r) => EMBEDDED_QR_REGEX.exec(r.sourceDetail ?? '')?.[0])
          .filter((c): c is string => !!c),
      );
    } catch (err) {
      report.problems.push(`Consulta de avarias abertas falhou: ${errMessage(err)}`);
      return;
    }

    for (const state of damaged) {
      if (openCodes.has(state.code)) continue; // one open report per code
      const correction: SyncCorrection = {
        kind: 'DAMAGED_REPORT',
        code: state.code,
        detail: `Abre avaria (1un) reportada pela plataforma externa`,
        applied: false,
      };
      if (live) {
        try {
          await this.fieldRepository.insertDamagedItem({
            tenantId,
            itemId: state.registry?.itemId ?? state.unit?.homologation.itemId ?? null,
            productNameSnapshot: state.productType,
            quantity: 1,
            source: 'SYNC_EXTERNO',
            sourceDetail: `QR ${state.code}`,
            reason: 'Reportado avariado pela plataforma externa',
          });
          correction.applied = true;
        } catch (err) {
          report.problems.push(`Abertura de avaria falhou para ${state.code}: ${errMessage(err)}`);
        }
      }
      report.corrections.push(correction);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 9 — persist the run report + release the lease
  // ---------------------------------------------------------------------------

  private async persistReport(tenantId: string, report: SyncRunReport): Promise<void> {
    const status: 'OK' | 'PARCIAL' | 'ERRO' = !report.ok ? 'ERRO' : report.problems.length > 0 ? 'PARCIAL' : 'OK';
    const persisted = {
      ...report,
      corrections: report.corrections.slice(0, REPORT_CORRECTIONS_CAP),
      correctionsTotal: report.corrections.length,
    };
    // Shadow trail: stdout carries only counts + a sanitized tenant id; the
    // full corrections payload lives in inv_external_sync_state.last_message
    // (CodeQL: no user-influenced format strings / payloads on stdout).
    if (!report.live && report.corrections.length > 0) {
      const safeTenant = /^[0-9a-f-]{36}$/i.test(tenantId) ? tenantId : 'invalid-tenant-id';
      // eslint-disable-next-line no-console -- J4 shadow-mode diff trail
      console.info(
        '[inv-external-sync] SHADOW: %d correction(s) NOT applied (tenant %s) — full report persisted in inv_external_sync_state.last_message',
        report.corrections.length,
        safeTenant,
      );
    }
    try {
      await this.repository.releaseLease(tenantId, {
        status,
        message: JSON.stringify(persisted),
        totalItems: report.total,
      });
    } catch (err) {
      // eslint-disable-next-line no-console -- last resort: never swallow silently
      console.error(`[inv-external-sync] falha ao liberar lease/persistir relatório: ${errMessage(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Response mapping
  // ---------------------------------------------------------------------------

  private toStateResponse(row: InvExternalStateRow): InvExternalStateResponse {
    return {
      id: row.id,
      code: row.code,
      productType: row.productType,
      location: row.location,
      status: row.status,
      technician: row.technician,
      clientName: row.clientName,
      qrValue: row.qrValue,
      itemId: row.itemId,
      homologationUnitId: row.homologationUnitId,
      lastChangeAt: toIso(row.lastChangeAt),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toSyncStateResponse(row: InvExternalSyncStateRow): NonNullable<ExternalSyncStatusResponse['syncState']> {
    const leaseUntil = row.leaseUntil ? new Date(row.leaseUntil) : null;
    return {
      tenantId: row.tenantId,
      leaseUntil: toIso(leaseUntil),
      leaseActive: !!leaseUntil && leaseUntil.getTime() > this.now().getTime(),
      lastRunAt: toIso(row.lastRunAt),
      lastStatus: row.lastStatus,
      lastMessage: row.lastMessage,
      totalItems: row.totalItems,
    };
  }
}

export const inventoryExternalSyncService = new InventoryExternalSyncService();
