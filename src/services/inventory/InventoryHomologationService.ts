// =============================================================================
// RFC-0061 M5 — Homologation service (business rules).
//
// §M5 rules ported from the source:
//   - box_size ∈ {1,10,50,100,224}; a box (box_size > 1) always carries a box
//     QR — auto-generated sequentially per size prefix when not sent
//     (`https://produto.myio.com.br/caixa-<N>/<seq>`);
//   - GLOBAL duplicate detection across box + unit QRs via inv_qr_registry
//     (A2): a friendly transactional pre-check plus the 23505 backstop
//     (SQLSTATE lives on `err.cause` — Drizzle wraps the driver error);
//   - remaining-to-homologate accounting per (release, item): homologating
//     above the remainder → 422;
//   - finishing a homologation writes the ENTRADA movement into ALMOXARIFADO
//     via InventoryStockService (reason "Homologação — unitário|caixa de N").
//     NOTE: the entry runs in the stock service's own transaction AFTER the
//     homologation transaction commits (M2 owns the ledger boundary) — see
//     the PR follow-up about a shared-transaction seam.
//   - box ops: add-unit (same-material incomplete box; INV_BOX_FULL /
//     INV_QR_WRONG_ITEM), remove-from-box (unit becomes a box_size=1
//     homologation; an emptied box is deleted along with its box-QR identity).
//
// M5 request DTOs live here (RFC §API conventions: "later phases may finalize
// DTOs at implementation time") so this module ships without touching the
// frozen P0/P1 DTO files.
// =============================================================================

import { z } from 'zod';
import {
  InventoryHomologationRepository,
  inventoryHomologationRepository,
  HomologDbClient,
  InvHomologationRow,
  InvHomologationUnitRow,
  NewUnitInput,
} from '../../repositories/inventory/InventoryHomologationRepository';
import { InventoryStockService, inventoryStockService } from './InventoryStockService';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../shared/errors/AppError';
import { InventoryError, qrDuplicate, qrWrongItem } from '../../shared/errors/InventoryError';
import { INV_BOX_SIZES } from '../../domain/entities/Inventory';
import type { InvPaginatedResponse } from '../../dto/response/InventoryResponseDTO';
import { PaginationQuerySchema } from '../../dto/request/InventoryDTO';

// -----------------------------------------------------------------------------
// M5 request DTOs
// -----------------------------------------------------------------------------

const uuid = z.string().uuid();

export const CreateHomologationSchema = z
  .object({
    itemId: uuid,
    releaseId: uuid.optional(),
    boxSize: z
      .number()
      .int()
      .refine((v) => (INV_BOX_SIZES as readonly number[]).includes(v), {
        message: `boxSize must be one of ${INV_BOX_SIZES.join(', ')}`,
      }),
    boxQr: z.string().min(1).max(512).optional(),
    responsibleId: uuid.optional(),
    notes: z.string().max(4096).optional(),
    units: z
      .array(
        z
          .object({
            qrValue: z.string().min(1).max(512),
            position: z.number().int().min(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(224),
  })
  .strict();
export type CreateHomologationDTO = z.infer<typeof CreateHomologationSchema>;

export const AddUnitToBoxSchema = z.object({ unitId: uuid }).strict();
export type AddUnitToBoxDTO = z.infer<typeof AddUnitToBoxSchema>;

export const HomologationListQuerySchema = PaginationQuerySchema.extend({
  itemId: uuid.optional(),
  releaseId: uuid.optional(),
});
export type HomologationListQuery = z.infer<typeof HomologationListQuerySchema>;

// -----------------------------------------------------------------------------
// Response shapes (M5 — finalized at implementation time, §API conventions)
// -----------------------------------------------------------------------------

export interface InvHomologationUnitResponse {
  id: string;
  qrValue: string;
  position: number | null;
}

export interface InvHomologationResponse {
  id: string;
  itemId: string;
  releaseId: string | null;
  boxSize: number;
  boxQr: string | null;
  responsibleId: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  units: InvHomologationUnitResponse[];
  /** Ledger entry written on creation (absent on plain reads). */
  movementId?: string;
}

export interface InvBoxResponse extends InvHomologationResponse {
  unitCount: number;
  isFull: boolean;
}

export interface InvRemoveFromBoxResponse {
  unit: InvHomologationUnitResponse;
  homologation: InvHomologationResponse;
  /** True when the source box was emptied and therefore deleted. */
  boxDeleted: boolean;
}

/** Caller identity from `req.context`. */
export interface HomologationContext {
  tenantId: string;
  userId?: string;
}

// -----------------------------------------------------------------------------
// Constants & seams
// -----------------------------------------------------------------------------

/** QR base URL kept from the source (§M5 — "QR formats kept"). */
export const QR_BASE_URL = 'https://produto.myio.com.br/';

/** Auto box-QR convention: `<base>caixa-<boxSize>/<seq>` (sequential per prefix). */
export function boxQrPrefix(boxSize: number): string {
  return `${QR_BASE_URL}caixa-${boxSize}/`;
}

export type IInventoryHomologationRepository = Pick<
  InventoryHomologationRepository,
  | 'withTransaction'
  | 'getItem'
  | 'releasedQuantity'
  | 'homologatedCount'
  | 'findRegistryByValues'
  | 'insertRegistryRows'
  | 'deleteRegistryByValues'
  | 'insertHomologation'
  | 'insertUnits'
  | 'getHomologationById'
  | 'getUnitById'
  | 'countUnits'
  | 'unitsByHomologationIds'
  | 'moveUnit'
  | 'deleteHomologation'
  | 'list'
  | 'maxBoxSeq'
>;

/** The one M2 seam this module calls (stock entry on homologation finish). */
export type IStockEntryService = Pick<InventoryStockService, 'createMovement'>;

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 2000;

/**
 * 422 — homologating above the remaining quantity of the linked release item.
 * Appendix D has no dedicated code; this module-local error carries a
 * machine-readable code + params the same way (surfaced as `error.details`).
 */
export class HomologationOverRemainingError extends AppError {
  public readonly details: Record<string, unknown>;

  constructor(released: number, homologated: number, requested: number) {
    super(
      'INV_HOMOLOGATION_OVER_REMAINING',
      'Quantidade excede o restante a homologar da liberação',
      422,
    );
    this.details = { released, homologated, remaining: released - homologated, requested };
  }
}

export class InventoryHomologationService {
  private repository: IInventoryHomologationRepository;
  private stockService: IStockEntryService;

  private idempotencyCache = new Map<string, { at: number; promise: Promise<unknown> }>();

  constructor(repository?: IInventoryHomologationRepository, stockService?: IStockEntryService) {
    this.repository = repository ?? inventoryHomologationRepository;
    this.stockService = stockService ?? inventoryStockService;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async listHomologations(
    tenantId: string,
    query: HomologationListQuery,
  ): Promise<InvPaginatedResponse<InvHomologationResponse>> {
    const { page, pageSize, itemId, releaseId } = query;
    const { rows, total } = await this.repository.list(tenantId, page, pageSize, { itemId, releaseId });
    const units = await this.repository.unitsByHomologationIds(tenantId, rows.map((r) => r.id));
    return {
      items: rows.map((row) => this.toResponse(row, units.filter((u) => u.homologationId === row.id))),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async listBoxes(
    tenantId: string,
    query: HomologationListQuery,
  ): Promise<InvPaginatedResponse<InvBoxResponse>> {
    const { page, pageSize, itemId, releaseId } = query;
    const { rows, total } = await this.repository.list(tenantId, page, pageSize, {
      itemId,
      releaseId,
      boxesOnly: true,
    });
    const units = await this.repository.unitsByHomologationIds(tenantId, rows.map((r) => r.id));
    return {
      items: rows.map((row) => {
        const boxUnits = units.filter((u) => u.homologationId === row.id);
        return {
          ...this.toResponse(row, boxUnits),
          unitCount: boxUnits.length,
          isFull: boxUnits.length >= row.boxSize,
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // Create homologation
  // ---------------------------------------------------------------------------

  async createHomologation(
    ctx: HomologationContext,
    dto: CreateHomologationDTO,
    idempotencyKey: string,
  ): Promise<InvHomologationResponse> {
    return this.idempotent(ctx.tenantId, `homologation:${idempotencyKey}`, () =>
      this.doCreateHomologation(ctx, dto, idempotencyKey),
    );
  }

  private async doCreateHomologation(
    ctx: HomologationContext,
    dto: CreateHomologationDTO,
    idempotencyKey: string,
  ): Promise<InvHomologationResponse> {
    // Shape rules before touching the DB.
    if (dto.boxSize === 1) {
      if (dto.boxQr) throw new ValidationError('Homologação unitária não possui QR de caixa');
      if (dto.units.length !== 1) {
        throw new ValidationError('Homologação unitária exige exatamente 1 unidade');
      }
    } else if (dto.units.length > dto.boxSize) {
      throw new InventoryError(
        'INV_BOX_TOO_BIG',
        `Caixa de ${dto.boxSize} não comporta ${dto.units.length} unidades`,
        422,
        { boxSize: dto.boxSize, units: dto.units.length },
      );
    }

    // In-payload duplicate check (cheap, friendly — the registry catches the rest).
    const seen = new Set<string>();
    for (const unit of dto.units) {
      if (seen.has(unit.qrValue)) throw qrDuplicate(unit.qrValue);
      seen.add(unit.qrValue);
    }
    if (dto.boxQr && seen.has(dto.boxQr)) throw qrDuplicate(dto.boxQr);

    let created: { homologation: InvHomologationRow; units: InvHomologationUnitRow[] };
    try {
      created = await this.repository.withTransaction(async (tx) => {
        const item = await this.repository.getItem(ctx.tenantId, dto.itemId, tx);
        if (!item) throw new NotFoundError(`Item ${dto.itemId} not found`);
        if (item.domain !== 'PRODUCT') {
          throw new ValidationError('Homologação aplica-se apenas a itens PRODUCT');
        }

        // Remaining-to-homologate accounting per release item (§M5).
        if (dto.releaseId) {
          const released = await this.repository.releasedQuantity(ctx.tenantId, dto.releaseId, dto.itemId, tx);
          if (released === null) {
            throw new NotFoundError(`Release ${dto.releaseId} has no item ${dto.itemId}`);
          }
          const homologated = await this.repository.homologatedCount(ctx.tenantId, dto.releaseId, dto.itemId, tx);
          if (homologated + dto.units.length > released) {
            throw new HomologationOverRemainingError(released, homologated, dto.units.length);
          }
        }

        // Box QR: mandatory for boxes — auto-generated per size prefix if absent.
        let boxQr = dto.boxQr ?? null;
        if (dto.boxSize > 1 && !boxQr) {
          const prefix = boxQrPrefix(dto.boxSize);
          const seq = (await this.repository.maxBoxSeq(ctx.tenantId, prefix, tx)) + 1;
          boxQr = `${prefix}${seq}`;
        }

        // Global cross box×unit duplicate pre-check against the registry (A2),
        // inside the transaction; the UNIQUE index is the concurrent backstop.
        const allValues = [...dto.units.map((u) => u.qrValue), ...(boxQr ? [boxQr] : [])];
        const existing = await this.repository.findRegistryByValues(ctx.tenantId, allValues, tx);
        if (existing.length > 0) throw qrDuplicate(existing[0].qrValue);

        const homologation = await this.repository.insertHomologation(
          {
            tenantId: ctx.tenantId,
            itemId: dto.itemId,
            releaseId: dto.releaseId ?? null,
            boxSize: dto.boxSize,
            boxQr,
            responsibleId: dto.responsibleId ?? null,
            notes: dto.notes ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );
        const unitInputs: NewUnitInput[] = dto.units.map((u, i) => ({
          qrValue: u.qrValue,
          position: u.position ?? i + 1,
        }));
        const units = await this.repository.insertUnits(ctx.tenantId, homologation.id, unitInputs, tx);

        await this.repository.insertRegistryRows(
          ctx.tenantId,
          [
            ...units.map((u) => ({
              qrValue: u.qrValue,
              kind: 'UNIT' as const,
              itemId: dto.itemId,
              createdBy: ctx.userId ?? null,
            })),
            ...(boxQr
              ? [{ qrValue: boxQr, kind: 'BOX' as const, itemId: dto.itemId, createdBy: ctx.userId ?? null }]
              : []),
          ],
          tx,
        );

        return { homologation, units };
      });
    } catch (err) {
      this.mapRepoError(err);
    }

    // Finishing a homologation = ENTRADA into ALMOXARIFADO (§M5), delegated to
    // the M2 ledger owner. Runs after the homologation tx commits — follow-up
    // in the PR about a shared-transaction seam.
    const reason =
      created.homologation.boxSize === 1
        ? 'Homologação — unitário'
        : `Homologação — caixa de ${created.homologation.boxSize}`;
    const movement = await this.stockService.createMovement(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      {
        itemId: dto.itemId,
        location: 'ALMOXARIFADO',
        quantity: created.units.length,
        type: 'ENTRADA',
        reason,
        qrs: created.units.map((u) => ({
          qrValue: u.qrValue,
          ...(created.homologation.boxQr ? { boxQr: created.homologation.boxQr } : {}),
          homologationUnitId: u.id,
        })),
      },
      `homologation-entry:${idempotencyKey}`,
    );

    return { ...this.toResponse(created.homologation, created.units), movementId: movement.id };
  }

  // ---------------------------------------------------------------------------
  // Box operations
  // ---------------------------------------------------------------------------

  /**
   * Move an existing homologated unit into an incomplete box of the SAME
   * material. The unit's source homologation loses it; an emptied source is
   * deleted (and a deleted box's QR identity is released from the registry).
   */
  async addUnitToBox(ctx: HomologationContext, boxId: string, dto: AddUnitToBoxDTO): Promise<InvBoxResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const box = await this.repository.getHomologationById(ctx.tenantId, boxId, tx);
        if (!box) throw new NotFoundError(`Box ${boxId} not found`);
        if (box.boxSize <= 1) {
          throw new ValidationError('Homologação unitária não é uma caixa');
        }

        const unit = await this.repository.getUnitById(ctx.tenantId, dto.unitId, tx);
        if (!unit) throw new NotFoundError(`Homologation unit ${dto.unitId} not found`);
        if (unit.homologationId === box.id) {
          throw new ValidationError('Unidade já pertence a esta caixa');
        }

        const source = await this.repository.getHomologationById(ctx.tenantId, unit.homologationId, tx);
        if (!source) throw new NotFoundError(`Homologation ${unit.homologationId} not found`);
        if (source.itemId !== box.itemId) throw qrWrongItem(unit.qrValue, box.itemId);

        const count = await this.repository.countUnits(box.id, tx);
        if (count >= box.boxSize) {
          throw new InventoryError('INV_BOX_FULL', 'Caixa cheia', 422, {
            boxId: box.id,
            boxSize: box.boxSize,
            unitCount: count,
          });
        }

        await this.repository.moveUnit(ctx.tenantId, unit.id, box.id, count + 1, tx);
        await this.deleteIfEmptied(ctx.tenantId, source, tx);

        const units = await this.repository.unitsByHomologationIds(ctx.tenantId, [box.id], tx);
        return {
          ...this.toResponse(box, units),
          unitCount: units.length,
          isFull: units.length >= box.boxSize,
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /**
   * Remove a unit from its box: the unit becomes a box_size=1 homologation of
   * its own; an emptied box is deleted (its box-QR identity is released).
   */
  async removeFromBox(ctx: HomologationContext, unitId: string): Promise<InvRemoveFromBoxResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const unit = await this.repository.getUnitById(ctx.tenantId, unitId, tx);
        if (!unit) throw new NotFoundError(`Homologation unit ${unitId} not found`);

        const box = await this.repository.getHomologationById(ctx.tenantId, unit.homologationId, tx);
        if (!box) throw new NotFoundError(`Homologation ${unit.homologationId} not found`);
        if (box.boxSize <= 1) {
          throw new InventoryError('INV_BOX_EMPTY', 'Unidade não está em uma caixa', 422, {
            unitId,
            homologationId: box.id,
          });
        }

        const solo = await this.repository.insertHomologation(
          {
            tenantId: ctx.tenantId,
            itemId: box.itemId,
            releaseId: box.releaseId,
            boxSize: 1,
            boxQr: null,
            responsibleId: box.responsibleId,
            notes: box.notes,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );
        const moved = await this.repository.moveUnit(ctx.tenantId, unit.id, solo.id, 1, tx);
        const boxDeleted = await this.deleteIfEmptied(ctx.tenantId, box, tx);

        return {
          unit: this.toUnitResponse(moved ?? unit),
          homologation: this.toResponse(solo, moved ? [moved] : [unit]),
          boxDeleted,
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /** Delete a homologation left with zero units; releases its box-QR identity. */
  private async deleteIfEmptied(
    tenantId: string,
    homologation: InvHomologationRow,
    tx: HomologDbClient,
  ): Promise<boolean> {
    const left = await this.repository.countUnits(homologation.id, tx);
    if (left > 0) return false;
    await this.repository.deleteHomologation(tenantId, homologation.id, tx);
    if (homologation.boxQr) {
      await this.repository.deleteRegistryByValues(tenantId, [homologation.boxQr], tx);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Idempotency (best-effort, per-process — same seam as M2; durable storage
  // is the standing inv_idempotency_keys follow-up)
  // ---------------------------------------------------------------------------

  private async idempotent<T>(tenantId: string, key: string, run: () => Promise<T>): Promise<T> {
    const cacheKey = `${tenantId}:${key}`;
    const now = Date.now();
    const hit = this.idempotencyCache.get(cacheKey);
    if (hit && now - hit.at < IDEMPOTENCY_TTL_MS) {
      return hit.promise as Promise<T>;
    }
    const promise = run();
    this.idempotencyCache.set(cacheKey, { at: now, promise });
    promise.catch(() => this.idempotencyCache.delete(cacheKey));
    if (this.idempotencyCache.size > IDEMPOTENCY_MAX_ENTRIES) {
      for (const [k, entry] of this.idempotencyCache) {
        if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) break;
        if (now - entry.at >= IDEMPOTENCY_TTL_MS) this.idempotencyCache.delete(k);
      }
      // Still over cap after the TTL sweep: drop oldest-inserted first.
      for (const k of this.idempotencyCache.keys()) {
        if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) break;
        this.idempotencyCache.delete(k);
      }
    }
    return promise;
  }

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  private toResponse(row: InvHomologationRow, units: InvHomologationUnitRow[]): InvHomologationResponse {
    return {
      id: row.id,
      itemId: row.itemId,
      releaseId: row.releaseId ?? null,
      boxSize: row.boxSize,
      boxQr: row.boxQr ?? null,
      responsibleId: row.responsibleId ?? null,
      notes: row.notes ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      createdBy: row.createdBy ?? null,
      units: units.map((u) => this.toUnitResponse(u)),
    };
  }

  private toUnitResponse(u: InvHomologationUnitRow): InvHomologationUnitResponse {
    return { id: u.id, qrValue: u.qrValue, position: u.position ?? null };
  }

  /**
   * Map low-level DB errors to the RFC contract. Drizzle wraps the driver
   * error (DrizzleQueryError): the real SQLSTATE lives on `err.cause.code`,
   * not `err.code`/`err.message` — inspect both (known gotcha).
   */
  private mapRepoError(err: unknown): never {
    if (err instanceof AppError) throw err;
    const top = err as {
      message?: string;
      code?: string;
      cause?: { message?: string; code?: string; detail?: string; constraint_name?: string };
    };
    const cause = top.cause ?? {};
    const code = cause.code ?? top.code;
    const message = `${top.message ?? String(err)}\n${cause.message ?? ''}`;

    if (code === '23505' || /duplicate key/i.test(message)) {
      // Concurrent duplicate past the pre-check: cross box×unit uniqueness is
      // held by inv_qr_registry_uq (plus the per-table QR uniques).
      const detail = cause.detail ?? '';
      const match = /\)=\([^,]+,\s*(.+)\)/.exec(detail);
      throw qrDuplicate(match ? match[1].trim() : 'desconhecido');
    }
    if (code === '23503' || /foreign key/i.test(message)) {
      throw new ValidationError('Referência inexistente (item, liberação ou unidade)');
    }
    if (code === '40001' || code === '40P01') {
      throw new ConflictError('Conflito de concorrência — tente novamente');
    }
    throw err;
  }
}

export const inventoryHomologationService = new InventoryHomologationService();
