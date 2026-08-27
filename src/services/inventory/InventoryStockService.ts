// =============================================================================
// RFC-0061 M2 — Stock ledger service (business rules).
//
// Owns the movement transaction (§M2):
//   lock item (FOR UPDATE) → derived balance → negative-stock guard →
//   exit-requirements matrix (W4) → anti-double-exit QR check → insert
//   movement (+ QR links) — all inside ONE repository transaction.
//
// Transfers are two legs (OUT with the guard + IN) in the SAME transaction
// sharing a transfer_group_id.
//
// Idempotency (S1/AC-9): the schema has NO durable idempotency storage for
// generic movements (only the M3 receipt-entry partial UNIQUE on
// (tenant_id, purchase_order_id) WHERE type='ENTRADA', enforced in the DB).
// Until an `inv_idempotency_keys` table lands (Follow-up in the M2 PR), the
// service keeps a best-effort per-process cache keyed by tenant+Idempotency-Key
// that replays the original result within a TTL. In-flight promises are
// shared, so a same-key retry racing the original does not double-insert
// within this process.
// =============================================================================

import { randomUUID } from 'crypto';
import {
  InventoryStockRepository,
  inventoryStockRepository,
  StockDbClient,
  InvItemRow,
  InvStockMovementRow,
  InvMovementQrRow,
  NewMovementQrInput,
  BalanceListFilters,
  BalanceListRow,
  ConsistencyRow,
} from '../../repositories/inventory/InventoryStockRepository';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/AppError';
import { insufficientStock, qrAlreadyUsed } from '../../shared/errors/InventoryError';
import type { CreateMovementDTO, CreateTransferDTO, StockResetDTO } from '../../dto/request/InventoryDTO';
import type {
  InvStockBalanceResponse,
  InvStockConsistencyRow,
  InvPaginatedResponse,
} from '../../dto/response/InventoryResponseDTO';
import type { InvItemDomain, InvStockLocation } from '../../domain/entities/Inventory';

// -----------------------------------------------------------------------------
// Repository seam (mocked in unit tests)
// -----------------------------------------------------------------------------

export type IInventoryStockRepository = Pick<
  InventoryStockRepository,
  | 'withTransaction'
  | 'lockItem'
  | 'getBalance'
  | 'listBalances'
  | 'listMovements'
  | 'getMovementById'
  | 'insertMovement'
  | 'insertMovementQrs'
  | 'latestQrEventTypes'
  | 'consistencyReport'
  | 'deleteMovements'
>;

/** Caller identity from `req.context`. */
export interface StockContext {
  tenantId: string;
  userId?: string;
}

/** Read model for one movement (+ linked QRs). */
export interface InvMovementResponse {
  id: string;
  itemId: string;
  location: string;
  quantity: number;
  type: string;
  reason: string | null;
  responsible: string | null;
  photoFileId: string | null;
  purchaseOrderId: string | null;
  transferGroupId: string | null;
  imported: boolean;
  createdAt: string;
  createdBy: string | null;
  qrs: Array<{ qrValue: string | null; boxQr: string | null; homologationUnitId: string | null }>;
}

export interface InvTransferResponse {
  transferGroupId: string;
  out: InvMovementResponse;
  in: InvMovementResponse;
}

export interface InvStockResetResponse {
  deletedMovements: number;
  location: string | null;
}

const EXIT_TYPES = new Set(['SAIDA', 'TRANSFERENCIA_OUT']);

// Idempotency cache tuning (best-effort, per-process — see header).
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 5000;

/** Ledger grain is numeric(12,3): compare in integer thousandths (no FP drift). */
function thousandths(n: number): number {
  return Math.round(n * 1000);
}

export class InventoryStockService {
  private repository: IInventoryStockRepository;

  private idempotencyCache = new Map<string, { at: number; promise: Promise<unknown> }>();

  constructor(repository?: IInventoryStockRepository) {
    this.repository = repository ?? inventoryStockRepository;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getBalances(
    tenantId: string,
    filters: BalanceListFilters = {},
  ): Promise<InvStockBalanceResponse[]> {
    const rows = await this.repository.listBalances(tenantId, filters);
    return rows.map((r: BalanceListRow) => ({
      itemId: r.itemId,
      itemName: r.itemName,
      domain: r.domain as InvItemDomain,
      location: r.location as InvStockLocation,
      balance: Number(r.balance),
      totalIn: Number(r.totalIn),
      totalOut: Number(r.totalOut),
      lastMovementAt: r.lastMovementAt ? new Date(r.lastMovementAt).toISOString() : null,
    }));
  }

  async listMovements(
    tenantId: string,
    page: number,
    pageSize: number,
  ): Promise<InvPaginatedResponse<InvMovementResponse>> {
    const { rows, total } = await this.repository.listMovements(tenantId, page, pageSize);
    return {
      items: rows.map((row) => this.toMovementResponse(row, [])),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getMovement(tenantId: string, id: string): Promise<InvMovementResponse> {
    const found = await this.repository.getMovementById(tenantId, id);
    if (!found) throw new NotFoundError(`Stock movement ${id} not found`);
    return this.toMovementResponse(found.movement, found.qrs);
  }

  /**
   * W1 consistency: ledger balance vs active-QR count per item×location for
   * manufactured PRODUCTs (QR registry is the authority there; the ledger is a
   * projection). drift = ledgerBalance − activeQrCount; non-zero is a defect.
   */
  async getConsistency(tenantId: string): Promise<InvStockConsistencyRow[]> {
    const rows = await this.repository.consistencyReport(tenantId);
    return rows.map((r: ConsistencyRow) => ({
      itemId: r.itemId,
      location: r.location as InvStockLocation,
      ledgerBalance: Number(r.ledgerBalance),
      activeQrCount: r.activeQrCount,
      drift: Number(r.ledgerBalance) - r.activeQrCount,
    }));
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async createMovement(
    ctx: StockContext,
    dto: CreateMovementDTO,
    idempotencyKey: string,
  ): Promise<InvMovementResponse> {
    return this.idempotent(ctx.tenantId, `movement:${idempotencyKey}`, () =>
      this.doCreateMovement(ctx, dto),
    );
  }

  async createTransfer(
    ctx: StockContext,
    dto: CreateTransferDTO,
    idempotencyKey: string,
  ): Promise<InvTransferResponse> {
    return this.idempotent(ctx.tenantId, `transfer:${idempotencyKey}`, () =>
      this.doCreateTransfer(ctx, dto),
    );
  }

  /** Destructive: wipes the ledger (whole tenant or one location) in one tx. */
  async reset(ctx: StockContext, dto: StockResetDTO): Promise<InvStockResetResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const deleted = await this.repository.deleteMovements(ctx.tenantId, dto.location, tx);
        return { deletedMovements: deleted, location: dto.location ?? null };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Movement transaction
  // ---------------------------------------------------------------------------

  private async doCreateMovement(ctx: StockContext, dto: CreateMovementDTO): Promise<InvMovementResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const item = await this.lockItemOr404(ctx.tenantId, dto.itemId, tx);

        if (EXIT_TYPES.has(dto.type)) {
          this.assertExitRequirements(item, dto.quantity, dto.photoFileId, dto.qrs, dto.responsible);
          await this.assertSufficientBalance(ctx.tenantId, dto.itemId, dto.location, dto.quantity, tx);
          await this.assertQrsNotExited(ctx.tenantId, dto.qrs, tx);
        }

        const movement = await this.repository.insertMovement(
          {
            tenantId: ctx.tenantId,
            itemId: dto.itemId,
            location: dto.location,
            quantity: String(dto.quantity),
            type: dto.type,
            reason: dto.reason ?? null,
            responsible: dto.responsible ?? null,
            photoFileId: dto.photoFileId ?? null,
            purchaseOrderId: dto.purchaseOrderId ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );

        const qrs = dto.qrs?.length
          ? await this.repository.insertMovementQrs(ctx.tenantId, movement.id, dto.qrs, tx)
          : [];

        return this.toMovementResponse(movement, qrs);
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  private async doCreateTransfer(ctx: StockContext, dto: CreateTransferDTO): Promise<InvTransferResponse> {
    const transferGroupId = randomUUID();
    try {
      return await this.repository.withTransaction(async (tx) => {
        await this.lockItemOr404(ctx.tenantId, dto.itemId, tx);
        await this.assertSufficientBalance(ctx.tenantId, dto.itemId, dto.fromLocation, dto.quantity, tx);

        const base = {
          tenantId: ctx.tenantId,
          itemId: dto.itemId,
          quantity: String(dto.quantity),
          reason: dto.reason ?? null,
          transferGroupId,
          createdBy: ctx.userId ?? null,
        };
        const outLeg = await this.repository.insertMovement(
          { ...base, location: dto.fromLocation, type: 'TRANSFERENCIA_OUT' },
          tx,
        );
        const inLeg = await this.repository.insertMovement(
          { ...base, location: dto.toLocation, type: 'TRANSFERENCIA_IN' },
          tx,
        );

        return {
          transferGroupId,
          out: this.toMovementResponse(outLeg, []),
          in: this.toMovementResponse(inLeg, []),
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  private async lockItemOr404(tenantId: string, itemId: string, tx: StockDbClient): Promise<InvItemRow> {
    const item = await this.repository.lockItem(tenantId, itemId, tx);
    if (!item) throw new NotFoundError(`Item ${itemId} not found`);
    return item;
  }

  /** Negative-stock guard — derived balance under the item lock (§M2/AC-2). */
  private async assertSufficientBalance(
    tenantId: string,
    itemId: string,
    location: string,
    requested: number,
    tx: StockDbClient,
  ): Promise<void> {
    const totals = await this.repository.getBalance(tenantId, itemId, location, tx);
    const balance = Number(totals.balance);
    if (thousandths(balance) < thousandths(requested)) {
      throw insufficientStock(itemId, location, balance, requested);
    }
  }

  /**
   * Exit-requirements matrix (W4), enforced server-side:
   *
   * | Domain            | is_manufactured | Exit requires                       |
   * |-------------------|-----------------|-------------------------------------|
   * | PRODUCT           | true            | QRs (count = quantity) AND photo    |
   * | PRODUCT/COMPONENT | false           | QR OR photo                         |
   * | THIRD_PARTY       | —               | photo (no QRs)                      |
   * | TOOL              | —               | destination (photo optional)        |
   *
   * The movement DTO has no dedicated `destination` field (schema/DTO are
   * frozen for this PR): TOOL destination rides on `responsible` — Follow-up.
   */
  private assertExitRequirements(
    item: InvItemRow,
    quantity: number,
    photoFileId: string | undefined,
    qrs: NewMovementQrInput[] | undefined,
    responsible: string | undefined,
  ): void {
    const qrCount = qrs?.length ?? 0;
    const domain = item.domain as InvItemDomain;

    if (domain === 'PRODUCT' && item.isManufactured) {
      if (qrCount === 0) {
        throw new ValidationError('Saída de produto manufaturado exige QRs vinculados');
      }
      if (thousandths(quantity) !== qrCount * 1000) {
        throw new ValidationError(
          `Saída de produto manufaturado: quantidade (${quantity}) deve igualar o número de QRs (${qrCount})`,
        );
      }
      if (!photoFileId) {
        throw new ValidationError('Saída de produto manufaturado exige foto');
      }
      return;
    }

    if (domain === 'PRODUCT' || domain === 'COMPONENT') {
      if (qrCount === 0 && !photoFileId) {
        throw new ValidationError('Saída exige QR ou foto');
      }
      return;
    }

    if (domain === 'THIRD_PARTY') {
      if (qrCount > 0) {
        throw new ValidationError('Saída de item de terceiros não aceita QRs');
      }
      if (!photoFileId) {
        throw new ValidationError('Saída de item de terceiros exige foto');
      }
      return;
    }

    // TOOL
    if (!responsible || responsible.trim() === '') {
      throw new ValidationError('Saída de ferramenta exige destino (responsible)');
    }
  }

  /** Anti-double-exit: a QR whose latest ledger event is an exit is spent. */
  private async assertQrsNotExited(
    tenantId: string,
    qrs: NewMovementQrInput[] | undefined,
    tx: StockDbClient,
  ): Promise<void> {
    const values = (qrs ?? []).map((q) => q.qrValue).filter((v): v is string => !!v);
    if (values.length === 0) return;
    const latest = await this.repository.latestQrEventTypes(tenantId, values, tx);
    for (const value of values) {
      const lastType = latest.get(value);
      if (lastType && EXIT_TYPES.has(lastType)) throw qrAlreadyUsed(value);
    }
  }

  // ---------------------------------------------------------------------------
  // Idempotency (best-effort, per-process — see header)
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
    // A failed attempt must NOT poison the key — the client retries with the
    // same Idempotency-Key precisely because the first try failed.
    promise.catch(() => this.idempotencyCache.delete(cacheKey));
    this.evictStaleIdempotencyEntries(now);
    return promise;
  }

  private evictStaleIdempotencyEntries(now: number): void {
    if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) return;
    for (const [key, entry] of this.idempotencyCache) {
      if (now - entry.at >= IDEMPOTENCY_TTL_MS) this.idempotencyCache.delete(key);
      if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) return;
    }
    // Still over cap after TTL sweep: drop oldest-inserted first (Map order).
    for (const key of this.idempotencyCache.keys()) {
      if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) return;
      this.idempotencyCache.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  private toMovementResponse(row: InvStockMovementRow, qrs: InvMovementQrRow[]): InvMovementResponse {
    return {
      id: row.id,
      itemId: row.itemId,
      location: row.location,
      quantity: Number(row.quantity),
      type: row.type,
      reason: row.reason ?? null,
      responsible: row.responsible ?? null,
      photoFileId: row.photoFileId ?? null,
      purchaseOrderId: row.purchaseOrderId ?? null,
      transferGroupId: row.transferGroupId ?? null,
      imported: row.imported ?? false,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      createdBy: row.createdBy ?? null,
      qrs: qrs.map((q) => ({
        qrValue: q.qrValue ?? null,
        boxQr: q.boxQr ?? null,
        homologationUnitId: q.homologationUnitId ?? null,
      })),
    };
  }

  /**
   * Map low-level DB errors to the RFC contract. Drizzle wraps the driver
   * error (DrizzleQueryError): the real SQLSTATE lives on `err.cause.code`,
   * not `err.code`/`err.message` — inspect both (same pattern as
   * EntityService.mapRepoError).
   */
  private mapRepoError(err: unknown): never {
    if (err instanceof AppError) throw err;
    const top = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    const cause = top.cause ?? {};
    const code = cause.code ?? top.code;
    const message = `${top.message ?? String(err)}\n${cause.message ?? ''}`;

    if (code === '23505' || /duplicate key/i.test(message)) {
      throw new ConflictError('Movimento duplicado (violação de unicidade)');
    }
    if (code === '23503' || /foreign key/i.test(message)) {
      throw new ValidationError('Referência inexistente (item, foto, OC ou unidade homologada)');
    }
    if (code === '40001' || code === '40P01') {
      throw new ConflictError('Conflito de concorrência — tente novamente');
    }
    throw err;
  }
}

export const inventoryStockService = new InventoryStockService();
