// =============================================================================
// RFC-0061 M3 — Purchase orders service (business rules).
//
// Owns the §M3 rules on top of InventoryPurchaseOrderRepository:
//   - create: requester = req.context.userId; item is a required catalog FK
//     with name/link snapshotted at request time; CUSTOMIZADO deadline needs a
//     date (double-checked here — the Zod DTO enforces it on create only).
//   - PATCH: requester fields only while PENDENTE (INV_EDIT_LOCKED_STATE 409);
//     buyer fields (buyerNotes, passphrase, deliveryForecast) in any state.
//   - status: PURCHASE_ORDER_TRANSITIONS enforced server-side (DEC-4) under a
//     FOR UPDATE row lock — illegal → INV_ILLEGAL_TRANSITION 409 (body carries
//     current + allowedTransitions), repeat → INV_ALREADY_IN_STATE 409.
//   - RECEBIDO_OK: exactly ONE idempotent ENTRADA via the M2 stock service.
//     `createMovement` owns its own transaction (it cannot join an external
//     tx), so the entry is created AFTER the status commit; the DB partial
//     UNIQUE (tenant_id, purchase_order_id) WHERE type='ENTRADA' (A1,
//     migration 0067) makes the entry exactly-once even across racing
//     processes — a duplicate insert is re-checked and treated as idempotent
//     success. Trade-off documented in the M3 PR.
//   - events: CRIADO / STATUS_ALTERADO {from,to} / OBSERVACAO_ATUALIZADA are
//     written in the SAME transaction as the mutation (WO-style model, DEC-9).
//   - reads include allowedTransitions (S3).
//
// RBAC (M10 — not yet wired): fine-grained role gating (requester-only edits,
// requester-only receipt confirmation, buyer statuses, admin-only delete) is
// centralized in the assertCallerMay* hooks below so M10 only fills them in.
// =============================================================================

import {
  InventoryPurchaseOrderRepository,
  inventoryPurchaseOrderRepository,
  PurchaseOrderTx,
  InvPurchaseOrderRow,
  InvPurchaseOrderEventRow,
  InvPurchaseOrderFileRow,
} from '../../repositories/inventory/InventoryPurchaseOrderRepository';
import {
  InventoryItemRepository,
  inventoryItemRepository,
} from '../../repositories/inventory/InventoryItemRepository';
import {
  InventoryProjectRepository,
  inventoryProjectRepository,
} from '../../repositories/inventory/InventoryProjectRepository';
import { InventoryStockService, inventoryStockService } from './InventoryStockService';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/AppError';
import { alreadyInState, editLockedState, illegalTransition } from '../../shared/errors/InventoryError';
import {
  PURCHASE_ORDER_TRANSITIONS,
  InvPurchaseOrderStatus,
} from '../../domain/entities/Inventory';
import type {
  CreatePurchaseOrderDTO,
  UpdatePurchaseOrderDTO,
  PurchaseOrderStatusDTO,
  PurchaseOrderListQuery,
} from '../../dto/request/InventoryDTO';
import type {
  InvPaginatedResponse,
  InvPurchaseOrderResponse,
} from '../../dto/response/InventoryResponseDTO';

// -----------------------------------------------------------------------------
// Seams (mocked in unit tests)
// -----------------------------------------------------------------------------

export type IInventoryPurchaseOrderRepository = Pick<
  InventoryPurchaseOrderRepository,
  | 'withTransaction'
  | 'list'
  | 'getById'
  | 'lockById'
  | 'insert'
  | 'update'
  | 'delete'
  | 'insertEvent'
  | 'listEvents'
  | 'findExistingFileAssetIds'
  | 'listFiles'
  | 'insertFiles'
  | 'deleteFiles'
  | 'hasReceiptEntry'
>;

export type IPurchaseItemRepository = Pick<InventoryItemRepository, 'getById'>;
export type IPurchaseProjectRepository = Pick<InventoryProjectRepository, 'getById'>;
export type IPurchaseStockService = Pick<InventoryStockService, 'createMovement'>;

/** Caller identity from `req.context`. */
export interface PurchaseOrderContext {
  tenantId: string;
  userId?: string;
}

// -----------------------------------------------------------------------------
// Read models (extend the frozen InvPurchaseOrderResponse with the remaining
// row columns — the response DTO file is frozen for this PR)
// -----------------------------------------------------------------------------

export interface InvPurchaseOrderFileResponse {
  id: string;
  fileId: string;
  createdAt: string;
}

export interface InvPurchaseOrderDetailResponse extends InvPurchaseOrderResponse {
  requesterId: string | null;
  itemLink: string | null;
  recipient: string | null;
  deliveryPoint: string | null;
  passphrase: string | null;
  /** Item's NACIONAL/IMPORTACAO — present on listing rows (buyer queue). */
  purchaseType?: string | null;
  /** Linked file_assets — present on detail reads and file mutations. */
  files?: InvPurchaseOrderFileResponse[];
}

export interface InvPurchaseOrderEventResponse {
  id: string;
  orderId: string;
  actorId: string | null;
  eventType: string;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Receipt entry constants (source trigger `stock_entry_on_receipt`, §M3). */
export const RECEIPT_ENTRY_LOCATION = 'FABRICA';
export const RECEIPT_ENTRY_REASON = 'Entrada automática — recebimento de compra';

/** Fields only the requester may edit, and only while PENDENTE. */
const REQUESTER_FIELDS = [
  'quantity',
  'recipient',
  'deliveryPoint',
  'deadlineType',
  'deadlineDate',
  'requesterNotes',
] as const;

/** Buyer/admin-managed fields, editable in any state. */
const BUYER_FIELDS = ['buyerNotes', 'passphrase', 'deliveryForecast'] as const;

export class InventoryPurchaseOrderService {
  private repository: IInventoryPurchaseOrderRepository;
  private itemRepository: IPurchaseItemRepository;
  private projectRepository: IPurchaseProjectRepository;
  private stockService: IPurchaseStockService;

  constructor(
    repository?: IInventoryPurchaseOrderRepository,
    itemRepository?: IPurchaseItemRepository,
    projectRepository?: IPurchaseProjectRepository,
    stockService?: IPurchaseStockService,
  ) {
    this.repository = repository ?? inventoryPurchaseOrderRepository;
    this.itemRepository = itemRepository ?? inventoryItemRepository;
    this.projectRepository = projectRepository ?? inventoryProjectRepository;
    this.stockService = stockService ?? inventoryStockService;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(
    ctx: PurchaseOrderContext,
    query: PurchaseOrderListQuery,
  ): Promise<InvPaginatedResponse<InvPurchaseOrderDetailResponse>> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.list(ctx.tenantId, {
      page,
      pageSize,
      status: query.status,
      projectId: query.projectId,
      purchaseType: query.purchaseType,
      groupByProject: query.groupByProject,
    });
    return {
      items: rows.map((r) => ({ ...this.toDetail(r.order), purchaseType: r.purchaseType ?? null })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getById(ctx: PurchaseOrderContext, id: string): Promise<InvPurchaseOrderDetailResponse> {
    const order = await this.repository.getById(ctx.tenantId, id);
    if (!order) throw new NotFoundError(`Purchase order ${id} not found`);
    const files = await this.repository.listFiles(ctx.tenantId, id);
    return { ...this.toDetail(order), files: files.map(this.toFileResponse) };
  }

  async listEvents(
    ctx: PurchaseOrderContext,
    id: string,
    page: number,
    pageSize: number,
  ): Promise<InvPaginatedResponse<InvPurchaseOrderEventResponse>> {
    const order = await this.repository.getById(ctx.tenantId, id);
    if (!order) throw new NotFoundError(`Purchase order ${id} not found`);
    const { rows, total } = await this.repository.listEvents(ctx.tenantId, id, page, pageSize);
    return {
      items: rows.map(this.toEventResponse),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(
    ctx: PurchaseOrderContext,
    dto: CreatePurchaseOrderDTO,
  ): Promise<InvPurchaseOrderDetailResponse> {
    const item = await this.itemRepository.getById(ctx.tenantId, dto.itemId);
    if (!item) throw new ValidationError(`Item ${dto.itemId} not found in tenant`);

    const project = await this.projectRepository.getById(ctx.tenantId, dto.projectId);
    if (!project) throw new ValidationError(`Project ${dto.projectId} not found in tenant`);

    const fileIds = dto.fileIds ?? [];
    await this.assertFileAssetsExist(ctx.tenantId, fileIds);

    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.repository.insert(
          {
            tenantId: ctx.tenantId,
            projectId: dto.projectId,
            requesterId: ctx.userId ?? null,
            itemId: dto.itemId,
            // Snapshot at request time — later catalog edits must not rewrite
            // what was asked for (§M3).
            itemNameSnapshot: item.name,
            itemLink: item.link ?? null,
            quantity: dto.quantity,
            recipient: dto.recipient ?? null,
            deliveryPoint: dto.deliveryPoint ?? null,
            deadlineType: dto.deadlineType,
            deadlineDate: dto.deadlineDate ? new Date(dto.deadlineDate) : null,
            requesterNotes: dto.requesterNotes ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );

        await this.repository.insertEvent(
          {
            tenantId: ctx.tenantId,
            orderId: order.id,
            actorId: ctx.userId ?? null,
            eventType: 'CRIADO',
            details: { status: order.status },
          },
          tx,
        );

        const files = fileIds.length
          ? await this.repository.insertFiles(ctx.tenantId, order.id, fileIds, ctx.userId ?? null, tx)
          : [];

        return { ...this.toDetail(order), files: files.map(this.toFileResponse) };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Update (PATCH)
  // ---------------------------------------------------------------------------

  async update(
    ctx: PurchaseOrderContext,
    id: string,
    dto: UpdatePurchaseOrderDTO,
  ): Promise<InvPurchaseOrderDetailResponse> {
    const touchesRequesterFields = REQUESTER_FIELDS.some((f) => dto[f] !== undefined);
    const touchesBuyerFields = BUYER_FIELDS.some((f) => dto[f] !== undefined);

    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, id, tx);
        const current = order.status as InvPurchaseOrderStatus;

        if (touchesRequesterFields) {
          this.assertCallerMayEditRequesterFields(ctx, order);
          if (current !== 'PENDENTE') throw editLockedState(current);
        }
        if (touchesBuyerFields) {
          this.assertCallerMayEditBuyerFields(ctx, order);
        }

        this.assertDeadlineConsistent(order, dto);

        const updated = await this.repository.update(
          ctx.tenantId,
          id,
          {
            ...(dto.quantity !== undefined && { quantity: dto.quantity }),
            ...(dto.recipient !== undefined && { recipient: dto.recipient }),
            ...(dto.deliveryPoint !== undefined && { deliveryPoint: dto.deliveryPoint }),
            ...(dto.deadlineType !== undefined && { deadlineType: dto.deadlineType }),
            ...(dto.deadlineDate !== undefined && {
              deadlineDate: dto.deadlineDate ? new Date(dto.deadlineDate) : null,
            }),
            ...(dto.requesterNotes !== undefined && { requesterNotes: dto.requesterNotes }),
            ...(dto.buyerNotes !== undefined && { buyerNotes: dto.buyerNotes }),
            ...(dto.passphrase !== undefined && { passphrase: dto.passphrase }),
            ...(dto.deliveryForecast !== undefined && {
              deliveryForecast: dto.deliveryForecast ? new Date(dto.deliveryForecast) : null,
            }),
            updatedBy: ctx.userId ?? null,
          },
          tx,
        );
        if (!updated) throw new NotFoundError(`Purchase order ${id} not found`);

        // Notes edits get their own timeline entry (§M3 event model). The
        // passphrase is deliberately NOT echoed into details (DEC-10).
        const notedFields = (['requesterNotes', 'buyerNotes'] as const).filter(
          (f) => dto[f] !== undefined,
        );
        if (notedFields.length > 0) {
          await this.repository.insertEvent(
            {
              tenantId: ctx.tenantId,
              orderId: id,
              actorId: ctx.userId ?? null,
              eventType: 'OBSERVACAO_ATUALIZADA',
              details: { fields: notedFields },
            },
            tx,
          );
        }

        return this.toDetail(updated);
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Status (DEC-4 state machine)
  // ---------------------------------------------------------------------------

  async changeStatus(
    ctx: PurchaseOrderContext,
    id: string,
    dto: PurchaseOrderStatusDTO,
  ): Promise<InvPurchaseOrderDetailResponse> {
    let updated: InvPurchaseOrderRow;
    try {
      updated = await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, id, tx);
        const current = order.status as InvPurchaseOrderStatus;
        const target = dto.status as InvPurchaseOrderStatus;

        if (target === current) throw alreadyInState(current);
        const allowed = PURCHASE_ORDER_TRANSITIONS[current] ?? [];
        if (!allowed.includes(target)) throw illegalTransition(current, allowed);
        this.assertCallerMayTransition(ctx, order, target);

        const row = await this.repository.update(
          ctx.tenantId,
          id,
          { status: target, updatedBy: ctx.userId ?? null },
          tx,
        );
        if (!row) throw new NotFoundError(`Purchase order ${id} not found`);

        await this.repository.insertEvent(
          {
            tenantId: ctx.tenantId,
            orderId: id,
            actorId: ctx.userId ?? null,
            eventType: 'STATUS_ALTERADO',
            details: { from: current, to: target, ...(dto.note ? { note: dto.note } : {}) },
          },
          tx,
        );

        return row;
      });
    } catch (err) {
      this.mapRepoError(err);
    }

    // Exactly-one automatic ENTRADA on receipt (§M3, AC-1). Runs after the
    // status commit because the M2 service owns its own transaction — the
    // partial UNIQUE (A1) still guarantees at-most-one entry per order.
    if (updated.status === 'RECEBIDO_OK') {
      await this.createReceiptEntry(ctx, updated);
    }

    return this.toDetail(updated);
  }

  /**
   * Idempotent receipt entry. `Idempotency-Key` is derived from the order id
   * (same-process replays short-circuit in the M2 cache); the durable guard is
   * the DB partial UNIQUE — when it fires (or any race loses), we re-check the
   * ledger and treat an existing entry as success.
   */
  private async createReceiptEntry(ctx: PurchaseOrderContext, order: InvPurchaseOrderRow): Promise<void> {
    try {
      await this.stockService.createMovement(
        { tenantId: ctx.tenantId, userId: ctx.userId },
        {
          itemId: order.itemId,
          location: RECEIPT_ENTRY_LOCATION,
          quantity: order.quantity,
          type: 'ENTRADA',
          reason: RECEIPT_ENTRY_REASON,
          purchaseOrderId: order.id,
        },
        `po-receipt:${order.id}`,
      );
    } catch (err) {
      const exists = await this.repository
        .hasReceiptEntry(ctx.tenantId, order.id)
        .catch(() => false);
      if (!exists) throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Files (link table → file_assets)
  // ---------------------------------------------------------------------------

  async addFiles(
    ctx: PurchaseOrderContext,
    id: string,
    fileIds: string[],
  ): Promise<{ orderId: string; files: InvPurchaseOrderFileResponse[] }> {
    const order = await this.repository.getById(ctx.tenantId, id);
    if (!order) throw new NotFoundError(`Purchase order ${id} not found`);
    await this.assertFileAssetsExist(ctx.tenantId, fileIds);

    try {
      await this.repository.insertFiles(ctx.tenantId, id, fileIds, ctx.userId ?? null);
    } catch (err) {
      this.mapRepoError(err);
    }
    const files = await this.repository.listFiles(ctx.tenantId, id);
    return { orderId: id, files: files.map(this.toFileResponse) };
  }

  async removeFiles(
    ctx: PurchaseOrderContext,
    id: string,
    fileIds: string[],
  ): Promise<{ orderId: string; removed: number }> {
    const order = await this.repository.getById(ctx.tenantId, id);
    if (!order) throw new NotFoundError(`Purchase order ${id} not found`);
    const removed = await this.repository.deleteFiles(ctx.tenantId, id, fileIds);
    return { orderId: id, removed };
  }

  // ---------------------------------------------------------------------------
  // Delete (destructive — confirmation guard enforced by the controller, S3)
  // ---------------------------------------------------------------------------

  async delete(ctx: PurchaseOrderContext, id: string): Promise<void> {
    this.assertCallerMayDelete(ctx);
    try {
      const deleted = await this.repository.delete(ctx.tenantId, id);
      if (!deleted) throw new NotFoundError(`Purchase order ${id} not found`);
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // RBAC hooks — M10 fills these in (no fine-grained roles yet: any principal
  // holding inventory:write may do everything, per the phased plan).
  // ---------------------------------------------------------------------------

  /** TODO(M10): only the requester may edit requester fields (and only PENDENTE). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private assertCallerMayEditRequesterFields(_ctx: PurchaseOrderContext, _order: InvPurchaseOrderRow): void {
    /* no-op until M10 RBAC lands */
  }

  /** TODO(M10): only buyer/admin may edit buyerNotes/passphrase/deliveryForecast. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private assertCallerMayEditBuyerFields(_ctx: PurchaseOrderContext, _order: InvPurchaseOrderRow): void {
    /* no-op until M10 RBAC lands */
  }

  /**
   * TODO(M10): ENTREGUE → RECEBIDO_OK|RECEBIDO_PROBLEMA is requester-only;
   * the other transitions are buyer/admin (§M3, RBAC mapping).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private assertCallerMayTransition(
    _ctx: PurchaseOrderContext,
    _order: InvPurchaseOrderRow,
    _target: InvPurchaseOrderStatus,
  ): void {
    /* no-op until M10 RBAC lands */
  }

  /** TODO(M10): DELETE /purchase-orders/:id is admin-only. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private assertCallerMayDelete(_ctx: PurchaseOrderContext): void {
    /* no-op until M10 RBAC lands */
  }

  // ---------------------------------------------------------------------------
  // Guards & helpers
  // ---------------------------------------------------------------------------

  private async lockOr404(tenantId: string, id: string, tx: PurchaseOrderTx): Promise<InvPurchaseOrderRow> {
    const order = await this.repository.lockById(tenantId, id, tx);
    if (!order) throw new NotFoundError(`Purchase order ${id} not found`);
    return order;
  }

  /** CUSTOMIZADO deadline must resolve to a concrete date after the patch. */
  private assertDeadlineConsistent(order: InvPurchaseOrderRow, dto: UpdatePurchaseOrderDTO): void {
    const effectiveType = dto.deadlineType !== undefined ? dto.deadlineType : order.deadlineType;
    const effectiveDate =
      dto.deadlineDate !== undefined ? dto.deadlineDate : order.deadlineDate;
    if (effectiveType === 'CUSTOMIZADO' && !effectiveDate) {
      throw new ValidationError('deadlineDate is required when deadlineType=CUSTOMIZADO');
    }
  }

  private async assertFileAssetsExist(tenantId: string, fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    const unique = [...new Set(fileIds)];
    const existing = new Set(await this.repository.findExistingFileAssetIds(tenantId, unique));
    const missing = unique.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new ValidationError(`File asset(s) not found in tenant: ${missing.join(', ')}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  private toDetail(row: InvPurchaseOrderRow): InvPurchaseOrderDetailResponse {
    const status = row.status as InvPurchaseOrderStatus;
    return {
      id: row.id,
      projectId: row.projectId,
      itemId: row.itemId,
      itemNameSnapshot: row.itemNameSnapshot ?? null,
      quantity: row.quantity,
      status,
      deadlineType: row.deadlineType ?? null,
      deadlineDate: row.deadlineDate ? new Date(row.deadlineDate).toISOString() : null,
      deliveryForecast: row.deliveryForecast ? new Date(row.deliveryForecast).toISOString() : null,
      requesterNotes: row.requesterNotes ?? null,
      buyerNotes: row.buyerNotes ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
      // S3 — the server serves the state machine; TODO(M10): trim per role.
      allowedTransitions: PURCHASE_ORDER_TRANSITIONS[status] ?? [],
      requesterId: row.requesterId ?? null,
      itemLink: row.itemLink ?? null,
      recipient: row.recipient ?? null,
      deliveryPoint: row.deliveryPoint ?? null,
      passphrase: row.passphrase ?? null,
    };
  }

  private toFileResponse(row: InvPurchaseOrderFileRow): InvPurchaseOrderFileResponse {
    return {
      id: row.id,
      fileId: row.fileId,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    };
  }

  private toEventResponse(row: InvPurchaseOrderEventRow): InvPurchaseOrderEventResponse {
    return {
      id: row.id,
      orderId: row.orderId,
      actorId: row.actorId ?? null,
      eventType: row.eventType,
      details: (row.details ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    };
  }

  /**
   * Map low-level DB errors to the RFC contract. Drizzle wraps the driver
   * error (DrizzleQueryError): the real SQLSTATE lives on `err.cause.code`,
   * not `err.code`/`err.message` — inspect both (known gotcha).
   */
  private mapRepoError(err: unknown): never {
    if (err instanceof AppError) throw err;
    const top = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    const cause = top.cause ?? {};
    const code = cause.code ?? top.code;
    const message = `${top.message ?? String(err)}\n${cause.message ?? ''}`;

    if (code === '23505' || /duplicate key/i.test(message)) {
      throw new ConflictError('Registro duplicado (violação de unicidade)');
    }
    if (code === '23503' || /foreign key/i.test(message)) {
      throw new ValidationError('Referência inexistente (projeto, item ou arquivo)');
    }
    if (code === '23514' || /check constraint/i.test(message)) {
      throw new ValidationError('Valor fora do intervalo permitido');
    }
    if (code === '40001' || code === '40P01') {
      throw new ConflictError('Conflito de concorrência — tente novamente');
    }
    throw err;
  }
}

export const inventoryPurchaseOrderService = new InventoryPurchaseOrderService();
