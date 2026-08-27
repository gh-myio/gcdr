// =============================================================================
// RFC-0061 M6 — Expedição service (business rules) + §M4 demand resolution.
//
// Owns the §M6 rules on top of InventoryExpeditionRepository:
//   - CRUD: project required (DEC-5 — items reference inv_items by FK),
//     delivery date, is_replacement badge; PATCH edits the header anywhere but
//     replaces items only while PENDENTE (deliveries CASCADE with items —
//     INV_EDIT_LOCKED_STATE 409 otherwise); DELETE is destructive
//     (confirmationToken guarded in the controller).
//   - State machine: EXPEDITION_ORDER_TRANSITIONS enforced server-side (DEC-4)
//     under a FOR UPDATE order lock — illegal → INV_ILLEGAL_TRANSITION 409
//     (body carries current + allowedTransitions), repeat →
//     INV_ALREADY_IN_STATE 409; reads expose allowedTransitions (S3). The
//     generic /status endpoint redirects EM_TRANSITO to /ship and PERDIDO to
//     /lost so their mandatory payloads can never be skipped.
//   - Baixa (deliver): quantity ≤ remaining, photo required, manufactured item
//     → EXACTLY one QR per unit, stockOnly (homologation registry + not
//     already used; box QRs expand to their units — M5 repo reads, in-tx);
//     writes inv_item_deliveries + inv_delivery_qrs + the SAIDA movement
//     (reason "Baixa para pedido Myio") composing the M2 repository seam
//     inside ONE transaction (same trade-off as M4: InventoryStockService.
//     createMovement owns its own transaction, so this service drives
//     inventoryStockRepository.lockItem/getBalance/insertMovement with the
//     delivery transaction's executor and re-applies the negative-stock
//     guard). Auto-status: all items delivered → PRONTO_ENTREGA, else
//     PRODUZINDO; never regresses ENTREGUE_CLIENTE.
//   - Ship: mandatory address/method/responsible/tracking/proof →
//     inv_shipments + EM_TRANSITO.
//   - ENTREGUE_CLIENTE: creates one inv_unit_products row per delivered unit
//     (idempotent — existing labels are skipped), labels matched from the
//     delivery QRs, "Projeto = Cliente" (client_name_snapshot = project name;
//     customer_id from the project when set), status PARADO.
//   - Return / lost / found: mandatory reason with the timestamped note stamps
//     ("[Retornado para Expedição em …]", "[Mercadoria perdida em …]",
//     "[Mercadoria encontrada em …]"); found maps the chosen sector to the
//     target status (Cliente → ENTREGUE_CLIENTE + unit products).
//   - Transit progress: per delivered QR against inv_external_states (no row =
//     "em transporte" by default) → "X de Y em transporte" + per item.
//   - External push (DEC-6): rows enqueued into inv_external_push_outbox in
//     the SAME transaction (deliver → expedicao, ship → transporte,
//     ENTREGUE_CLIENTE → cliente, return → expedicao, lost → perdido, found →
//     sector). The HTTP client/drain worker is M8.
//   - §M4 demand resolution (POST /production/resolve-demand, A4): expedition
//     items short on ALMOXARIFADO stock → inv_production_demands
//     (manufactured) or an automatic purchase order (recipient/delivery point
//     "Estoque", CUSTOMIZADO deadline = delivery date, note "Demanda
//     automática do pedido") + inv_purchase_demands (purchasable) — idempotent
//     per expedition_order_item_id (UNIQUE, onConflictDoNothing).
//
// M6 DTOs live here (exported Zod schemas): the RFC finalizes later-phase DTOs
// at implementation time and src/dto is frozen for this PR (module-boundary
// rule) — follow-up: fold them into src/dto/request/InventoryDTO.ts in a
// consolidating PR (same follow-up as M4/M5).
// =============================================================================

import { z } from 'zod';
import {
  InventoryExpeditionRepository,
  inventoryExpeditionRepository,
  ExpeditionTx,
  InvExpeditionOrderRow,
  InvShipmentRow,
  OrderItemWithName,
  DeliveredQrRow,
  NewDeliveryQrInput,
} from '../../repositories/inventory/InventoryExpeditionRepository';
import {
  InventoryStockRepository,
  inventoryStockRepository,
} from '../../repositories/inventory/InventoryStockRepository';
import {
  InventoryHomologationRepository,
  inventoryHomologationRepository,
  InvHomologationRow,
  InvHomologationUnitRow,
  InvQrRegistryRow,
  UnitWithHomologationRow,
} from '../../repositories/inventory/InventoryHomologationRepository';
import {
  InventoryItemRepository,
  inventoryItemRepository,
} from '../../repositories/inventory/InventoryItemRepository';
import {
  InventoryPurchaseOrderService,
  inventoryPurchaseOrderService,
} from './InventoryPurchaseOrderService';
import { normalizeQrInput } from './InventoryQrService';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/AppError';
import {
  InventoryError,
  alreadyInState,
  editLockedState,
  illegalTransition,
  insufficientStock,
  qrAlreadyUsed,
  qrNotInRegistry,
  qrWrongItem,
} from '../../shared/errors/InventoryError';
import {
  EXPEDITION_ORDER_TRANSITIONS,
  INV_SHIPPING_METHODS,
  InvExpeditionStatus,
} from '../../domain/entities/Inventory';
import { PaginationQuerySchema } from '../../dto/request/InventoryDTO';
import type {
  InvPaginatedResponse,
  InvExpeditionOrderResponse,
} from '../../dto/response/InventoryResponseDTO';

// -----------------------------------------------------------------------------
// Request DTOs (M6 — finalized at implementation time per the RFC)
// -----------------------------------------------------------------------------

const uuid = z.string().uuid();

const EXPEDITION_STATUSES = [
  'PENDENTE',
  'PRODUZINDO',
  'PRONTO_ENTREGA',
  'EM_TRANSITO',
  'ENTREGUE_CLIENTE',
  'PERDIDO',
] as const;

const OrderItemsSchema = z
  .array(z.object({ itemId: uuid, quantity: z.number().int().min(1).max(100000) }).strict())
  .min(1)
  .max(200);

function assertUniqueItemIds(items: Array<{ itemId: string }>, ctx: z.RefinementCtx): void {
  if (new Set(items.map((i) => i.itemId)).size !== items.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate itemId in items', path: ['items'] });
  }
}

export const CreateExpeditionOrderSchema = z
  .object({
    title: z.string().max(255).optional(),
    projectId: uuid,
    customerId: uuid.optional(),
    deliveryDate: z.string().datetime(),
    isReplacement: z.boolean().optional(),
    notes: z.string().max(4096).optional(),
    items: OrderItemsSchema,
  })
  .strict()
  .superRefine((v, ctx) => assertUniqueItemIds(v.items, ctx));
export type CreateExpeditionOrderDTO = z.infer<typeof CreateExpeditionOrderSchema>;

export const UpdateExpeditionOrderSchema = z
  .object({
    title: z.string().max(255).nullable().optional(),
    projectId: uuid.optional(),
    customerId: uuid.nullable().optional(),
    deliveryDate: z.string().datetime().optional(),
    isReplacement: z.boolean().optional(),
    notes: z.string().max(4096).nullable().optional(),
    /** Full item replace — allowed only while PENDENTE (INV_EDIT_LOCKED_STATE). */
    items: OrderItemsSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.items) assertUniqueItemIds(v.items, ctx);
  });
export type UpdateExpeditionOrderDTO = z.infer<typeof UpdateExpeditionOrderSchema>;

export const ExpeditionOrderListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(EXPEDITION_STATUSES).optional(),
  projectId: uuid.optional(),
});
export type ExpeditionOrderListQuery = z.infer<typeof ExpeditionOrderListQuerySchema>;

export const ExpeditionStatusSchema = z
  .object({
    status: z.enum(['PRODUZINDO', 'PRONTO_ENTREGA', 'EM_TRANSITO', 'ENTREGUE_CLIENTE', 'PERDIDO']),
  })
  .strict();
export type ExpeditionStatusDTO = z.infer<typeof ExpeditionStatusSchema>;

export const DeliverItemSchema = z
  .object({
    quantity: z.number().int().min(1).max(100000),
    photoFileId: uuid,
    /** Bare codes or full produto.myio.com.br URLs; box QRs expand to units. */
    qrs: z.array(z.string().min(1).max(512)).max(500).optional(),
  })
  .strict();
export type DeliverItemDTO = z.infer<typeof DeliverItemSchema>;

export const ShipExpeditionSchema = z
  .object({
    address: z.string().min(1).max(1024),
    shippingMethod: z.enum(INV_SHIPPING_METHODS as unknown as [string, ...string[]]),
    responsible: z.string().min(1).max(255),
    trackingCode: z.string().min(1).max(255),
    proofFileId: uuid,
    notes: z.string().max(4096).optional(),
  })
  .strict();
export type ShipExpeditionDTO = z.infer<typeof ShipExpeditionSchema>;

export const ReturnExpeditionSchema = z.object({ reason: z.string().min(1).max(4096) }).strict();
export type ReturnExpeditionDTO = z.infer<typeof ReturnExpeditionSchema>;

export const LostExpeditionSchema = z.object({ reason: z.string().min(1).max(4096) }).strict();
export type LostExpeditionDTO = z.infer<typeof LostExpeditionSchema>;

export const FOUND_SECTORS = ['CLIENTE', 'EXPEDICAO', 'TRANSPORTE', 'ESTOQUE'] as const;
export type InvFoundSector = (typeof FOUND_SECTORS)[number];

export const FoundExpeditionSchema = z
  .object({
    sector: z.enum(FOUND_SECTORS),
    notes: z.string().max(4096).optional(),
  })
  .strict();
export type FoundExpeditionDTO = z.infer<typeof FoundExpeditionSchema>;

export const ResolveDemandSchema = z.object({ expeditionOrderId: uuid }).strict();
export type ResolveDemandDTO = z.infer<typeof ResolveDemandSchema>;

// -----------------------------------------------------------------------------
// Response read models
// -----------------------------------------------------------------------------

export interface InvExpeditionOrderItemResponse {
  id: string;
  itemId: string;
  itemName: string;
  isManufactured: boolean;
  quantity: number;
  delivered: number;
  remaining: number;
}

export interface InvExpeditionOrderDetailResponse extends InvExpeditionOrderResponse {
  notes: string | null;
  items: InvExpeditionOrderItemResponse[];
}

export interface InvDeliverResponse {
  order: InvExpeditionOrderDetailResponse;
  delivery: {
    id: string;
    orderItemId: string;
    quantity: number;
    photoFileId: string;
    createdAt: string;
  };
  movementId: string | null;
  qrs: Array<{ qrValue: string; boxQr: string | null }>;
  autoAdvanced: boolean;
}

export interface InvShipmentResponse {
  id: string;
  orderId: string;
  address: string | null;
  shippingMethod: string;
  responsible: string | null;
  trackingCode: string | null;
  proofFileId: string;
  notes: string | null;
  createdAt: string;
}

export interface InvUnitProductsSummary {
  created: number;
  skipped: number;
  labels: string[];
}

export interface InvStatusChangeResponse {
  order: InvExpeditionOrderDetailResponse;
  unitProducts?: InvUnitProductsSummary;
}

export interface InvShipResponse {
  order: InvExpeditionOrderDetailResponse;
  shipment: InvShipmentResponse;
}

export interface InvTransitUnit {
  qrValue: string;
  inTransit: boolean;
  externalLocation: string | null;
  externalStatus: string | null;
}

export interface InvTransitItemProgress {
  orderItemId: string;
  itemId: string;
  itemName: string;
  total: number;
  inTransit: number;
  units: InvTransitUnit[];
}

export interface InvTransitProgressResponse extends InvPaginatedResponse<InvTransitItemProgress> {
  orderId: string;
  status: InvExpeditionStatus;
  totalUnits: number;
  unitsInTransit: number;
  /** Badge text — "X de Y em transporte". */
  summary: string;
}

export type ResolveDemandAction = 'NONE' | 'PRODUCTION_DEMAND' | 'PURCHASE_ORDER' | 'ALREADY_RESOLVED';

export interface InvResolveDemandItemResult {
  orderItemId: string;
  itemId: string;
  itemName: string;
  required: number;
  balance: number;
  shortage: number;
  action: ResolveDemandAction;
  productionDemandId?: string;
  purchaseDemandId?: string;
  purchaseOrderId?: string;
}

export interface InvResolveDemandResponse {
  orderId: string;
  items: InvResolveDemandItemResult[];
}

// -----------------------------------------------------------------------------
// Seams (mocked in unit tests)
// -----------------------------------------------------------------------------

export type IInventoryExpeditionRepository = Pick<
  InventoryExpeditionRepository,
  | 'withTransaction'
  | 'list'
  | 'getById'
  | 'lockById'
  | 'insertOrder'
  | 'updateOrder'
  | 'deleteOrder'
  | 'listItemsByOrders'
  | 'getOrderItem'
  | 'insertItems'
  | 'deleteItemsByOrder'
  | 'deliveredQuantities'
  | 'insertDelivery'
  | 'insertDeliveryQrs'
  | 'deliveredQrsByOrder'
  | 'insertShipment'
  | 'existingUnitProductLabels'
  | 'insertUnitProducts'
  | 'getProject'
  | 'externalStatesByCodes'
  | 'enqueuePush'
  | 'findProductionDemandsByOrderItemIds'
  | 'findPurchaseDemandsByOrderItemIds'
  | 'insertProductionDemand'
  | 'insertPurchaseDemand'
  | 'setPurchaseDemandOrder'
>;

/** The M2 seam composed inside the delivery transaction (same as M4). */
export type IExpeditionStockRepository = Pick<
  InventoryStockRepository,
  'lockItem' | 'getBalance' | 'insertMovement' | 'insertMovementQrs' | 'latestQrEventTypes'
>;

/** The M5 seam — stockOnly QR validation + box expansion, in-tx reads. */
export type IExpeditionHomologationRepository = Pick<
  InventoryHomologationRepository,
  'findRegistryByValues' | 'findUnitsByQrValues' | 'findBoxesByQrValues' | 'unitsByHomologationIds' | 'deliveryEventsByQrs'
>;

export type IExpeditionItemRepository = Pick<InventoryItemRepository, 'findByIds'>;

/** The M3 seam — automatic purchase order on demand resolution. */
export type IExpeditionPurchaseOrderService = Pick<InventoryPurchaseOrderService, 'create'>;

export interface ExpeditionContext {
  tenantId: string;
  userId?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Finished goods leave the warehouse (homologation entered them there — §M5). */
export const DELIVERY_LOCATION = 'ALMOXARIFADO';
export const REASON_EXPEDITION_DELIVERY = 'Baixa para pedido Myio';
export const AUTO_PURCHASE_RECIPIENT = 'Estoque';
export const AUTO_PURCHASE_DELIVERY_POINT = 'Estoque';
export const AUTO_PURCHASE_NOTE = 'Demanda automática do pedido';

/** States that still accept item deliveries (baixa). */
const DELIVERABLE_STATES: ReadonlySet<string> = new Set(['PENDENTE', 'PRODUZINDO', 'PRONTO_ENTREGA']);

const EXIT_TYPES = new Set(['SAIDA', 'TRANSFERENCIA_OUT']);

const SECTOR_TO_STATUS: Record<InvFoundSector, InvExpeditionStatus> = {
  CLIENTE: 'ENTREGUE_CLIENTE',
  EXPEDICAO: 'PRONTO_ENTREGA',
  TRANSPORTE: 'EM_TRANSITO',
  ESTOQUE: 'PRODUZINDO',
};

const SECTOR_TO_PUSH: Record<InvFoundSector, string> = {
  CLIENTE: 'cliente',
  EXPEDICAO: 'expedicao',
  TRANSPORTE: 'transporte',
  ESTOQUE: 'estoque',
};

const SECTOR_LABEL: Record<InvFoundSector, string> = {
  CLIENTE: 'Cliente',
  EXPEDICAO: 'Expedição',
  TRANSPORTE: 'Transporte',
  ESTOQUE: 'Estoque',
};

// Idempotency cache tuning (best-effort, per-process — same M2/M4 pattern).
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 5000;

/** Append a timestamped stamp to the order notes (kept newline-separated). */
function stampNotes(existing: string | null, stamp: string): string {
  return existing && existing.trim() !== '' ? `${existing}\n${stamp}` : stamp;
}

export function returnStamp(isoDate: string, reason: string): string {
  return `[Retornado para Expedição em ${isoDate}] ${reason}`;
}

export function lostStamp(isoDate: string, reason: string): string {
  return `[Mercadoria perdida em ${isoDate}] ${reason}`;
}

export function foundStamp(isoDate: string, sector: InvFoundSector, notes?: string): string {
  const base = `[Mercadoria encontrada em ${isoDate}] Setor: ${SECTOR_LABEL[sector]}`;
  return notes && notes.trim() !== '' ? `${base} — ${notes}` : base;
}

export class InventoryExpeditionService {
  private repository: IInventoryExpeditionRepository;

  private stockRepository: IExpeditionStockRepository;

  private homologationRepository: IExpeditionHomologationRepository;

  private itemRepository: IExpeditionItemRepository;

  private purchaseOrderService: IExpeditionPurchaseOrderService;

  private idempotencyCache = new Map<string, { at: number; promise: Promise<unknown> }>();

  constructor(
    repository?: IInventoryExpeditionRepository,
    stockRepository?: IExpeditionStockRepository,
    homologationRepository?: IExpeditionHomologationRepository,
    itemRepository?: IExpeditionItemRepository,
    purchaseOrderService?: IExpeditionPurchaseOrderService,
  ) {
    this.repository = repository ?? inventoryExpeditionRepository;
    this.stockRepository = stockRepository ?? inventoryStockRepository;
    this.homologationRepository = homologationRepository ?? inventoryHomologationRepository;
    this.itemRepository = itemRepository ?? inventoryItemRepository;
    this.purchaseOrderService = purchaseOrderService ?? inventoryPurchaseOrderService;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(
    ctx: ExpeditionContext,
    query: ExpeditionOrderListQuery,
  ): Promise<InvPaginatedResponse<InvExpeditionOrderDetailResponse>> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.list(ctx.tenantId, page, pageSize, {
      status: query.status,
      projectId: query.projectId,
    });
    const items = await this.repository.listItemsByOrders(ctx.tenantId, rows.map((r) => r.id));
    const byOrder = new Map<string, OrderItemWithName[]>();
    for (const item of items) {
      const list = byOrder.get(item.orderId) ?? [];
      list.push(item);
      byOrder.set(item.orderId, list);
    }
    const detailed: InvExpeditionOrderDetailResponse[] = [];
    for (const row of rows) {
      const delivered = await this.repository.deliveredQuantities(ctx.tenantId, row.id);
      detailed.push(this.toDetail(row, byOrder.get(row.id) ?? [], delivered));
    }
    return { items: detailed, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  async getById(ctx: ExpeditionContext, id: string): Promise<InvExpeditionOrderDetailResponse> {
    const order = await this.repository.getById(ctx.tenantId, id);
    if (!order) throw new NotFoundError(`Expedition order ${id} not found`);
    return this.loadDetail(ctx, order);
  }

  // ---------------------------------------------------------------------------
  // Create / update / delete
  // ---------------------------------------------------------------------------

  async create(ctx: ExpeditionContext, dto: CreateExpeditionOrderDTO): Promise<InvExpeditionOrderDetailResponse> {
    await this.assertItemsExist(ctx.tenantId, dto.items.map((i) => i.itemId));
    const project = await this.repository.getProject(ctx.tenantId, dto.projectId);
    if (!project) throw new ValidationError(`Project ${dto.projectId} not found in tenant`);

    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.repository.insertOrder(
          {
            tenantId: ctx.tenantId,
            title: dto.title ?? null,
            projectId: dto.projectId,
            customerId: dto.customerId ?? project.customerId ?? null,
            deliveryDate: new Date(dto.deliveryDate),
            isReplacement: dto.isReplacement ?? false,
            notes: dto.notes ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );
        await this.repository.insertItems(
          dto.items.map((i) => ({
            tenantId: ctx.tenantId,
            orderId: order.id,
            itemId: i.itemId,
            quantity: i.quantity,
          })),
          tx,
        );
        return this.loadDetail(ctx, order, tx);
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async update(
    ctx: ExpeditionContext,
    id: string,
    dto: UpdateExpeditionOrderDTO,
  ): Promise<InvExpeditionOrderDetailResponse> {
    if (dto.items) await this.assertItemsExist(ctx.tenantId, dto.items.map((i) => i.itemId));
    if (dto.projectId) {
      const project = await this.repository.getProject(ctx.tenantId, dto.projectId);
      if (!project) throw new ValidationError(`Project ${dto.projectId} not found in tenant`);
    }

    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, id, tx);

        // Item replace only while PENDENTE — the schema CASCADEs deliveries
        // with the items, so replacing after a baixa would drop history.
        if (dto.items && order.status !== 'PENDENTE') {
          throw editLockedState(order.status);
        }

        const patch: Parameters<IInventoryExpeditionRepository['updateOrder']>[2] = {
          updatedBy: ctx.userId ?? null,
        };
        if (dto.title !== undefined) patch.title = dto.title;
        if (dto.projectId !== undefined) patch.projectId = dto.projectId;
        if (dto.customerId !== undefined) patch.customerId = dto.customerId;
        if (dto.deliveryDate !== undefined) patch.deliveryDate = new Date(dto.deliveryDate);
        if (dto.isReplacement !== undefined) patch.isReplacement = dto.isReplacement;
        if (dto.notes !== undefined) patch.notes = dto.notes;

        const updated = (await this.repository.updateOrder(ctx.tenantId, id, patch, tx)) ?? order;

        if (dto.items) {
          await this.repository.deleteItemsByOrder(ctx.tenantId, id, tx);
          await this.repository.insertItems(
            dto.items.map((i) => ({
              tenantId: ctx.tenantId,
              orderId: id,
              itemId: i.itemId,
              quantity: i.quantity,
            })),
            tx,
          );
        }

        return this.loadDetail(ctx, updated, tx);
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /** Hard delete (destructive — confirmationToken guarded in the controller). */
  async delete(ctx: ExpeditionContext, id: string): Promise<{ deleted: boolean }> {
    try {
      const deleted = await this.repository.deleteOrder(ctx.tenantId, id);
      if (!deleted) throw new NotFoundError(`Expedition order ${id} not found`);
      return { deleted: true };
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Generic status transition (DEC-4)
  // ---------------------------------------------------------------------------

  async changeStatus(
    ctx: ExpeditionContext,
    id: string,
    dto: ExpeditionStatusDTO,
  ): Promise<InvStatusChangeResponse> {
    const target = dto.status as InvExpeditionStatus;
    // Flows with mandatory payloads own their transitions — never skippable.
    if (target === 'EM_TRANSITO') {
      throw new ValidationError('Use POST /expedition-orders/:id/ship — dados de expedição são obrigatórios');
    }
    if (target === 'PERDIDO') {
      throw new ValidationError('Use POST /expedition-orders/:id/lost — motivo é obrigatório');
    }

    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, id, tx);
        const current = order.status as InvExpeditionStatus;
        if (current === target) throw alreadyInState(current);
        if (current === 'PERDIDO') {
          throw new ValidationError('Use POST /expedition-orders/:id/found — pedido está PERDIDO');
        }
        const allowed = EXPEDITION_ORDER_TRANSITIONS[current] ?? [];
        if (!allowed.includes(target)) throw illegalTransition(current, allowed);

        let unitProducts: InvUnitProductsSummary | undefined;
        if (target === 'ENTREGUE_CLIENTE') {
          unitProducts = await this.createUnitProductsForClient(ctx, order, tx);
        }

        const updated = await this.repository.updateOrder(
          ctx.tenantId,
          id,
          { status: target, updatedBy: ctx.userId ?? null },
          tx,
        );
        const detail = await this.loadDetail(ctx, updated ?? order, tx);
        return unitProducts ? { order: detail, unitProducts } : { order: detail };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Baixa/separação (deliver)
  // ---------------------------------------------------------------------------

  async deliverItem(
    ctx: ExpeditionContext,
    orderId: string,
    orderItemId: string,
    dto: DeliverItemDTO,
    idempotencyKey: string,
  ): Promise<InvDeliverResponse> {
    return this.idempotent(ctx.tenantId, `deliver:${idempotencyKey}`, () =>
      this.doDeliverItem(ctx, orderId, orderItemId, dto),
    );
  }

  private async doDeliverItem(
    ctx: ExpeditionContext,
    orderId: string,
    orderItemId: string,
    dto: DeliverItemDTO,
  ): Promise<InvDeliverResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, orderId, tx);
        const current = order.status as InvExpeditionStatus;
        if (!DELIVERABLE_STATES.has(current)) {
          throw illegalTransition(current, EXPEDITION_ORDER_TRANSITIONS[current] ?? []);
        }

        const orderItem = await this.repository.getOrderItem(ctx.tenantId, orderItemId, tx);
        if (!orderItem || orderItem.orderId !== orderId) {
          throw new NotFoundError(`Order item ${orderItemId} not found in expedition order ${orderId}`);
        }

        // quantity ≤ disponível (remaining = ordered − already delivered).
        const delivered = await this.repository.deliveredQuantities(ctx.tenantId, orderId, tx);
        const alreadyDelivered = delivered.get(orderItemId) ?? 0;
        const remaining = orderItem.quantity - alreadyDelivered;
        if (dto.quantity > remaining) {
          throw new ValidationError(
            `Quantidade (${dto.quantity}) excede o disponível para baixa (${remaining}) do item ${orderItem.itemName}`,
          );
        }

        // Lock the item (M2 seam) — serializes concurrent exits per item.
        const item = await this.stockRepository.lockItem(ctx.tenantId, orderItem.itemId, tx);
        if (!item) throw new NotFoundError(`Item ${orderItem.itemId} not found`);

        // Manufactured → exactly one stockOnly QR per unit (boxes expand).
        let qrLinks: NewDeliveryQrInput[] = [];
        if (item.isManufactured) {
          qrLinks = await this.resolveDeliveryQrs(ctx.tenantId, orderItem.itemId, dto.quantity, dto.qrs ?? [], tx);
        } else if (dto.qrs && dto.qrs.length > 0) {
          throw new ValidationError('QRs são aceitos apenas na baixa de itens manufaturados');
        }

        // Negative-stock guard on the derived balance (M2 sequence).
        const totals = await this.stockRepository.getBalance(ctx.tenantId, orderItem.itemId, DELIVERY_LOCATION, tx);
        const balance = Number(totals.balance);
        if (Math.round(balance * 1000) < Math.round(dto.quantity * 1000)) {
          throw insufficientStock(orderItem.itemId, DELIVERY_LOCATION, balance, dto.quantity);
        }

        // Delivery + QRs + the SAIDA movement — one transaction.
        const delivery = await this.repository.insertDelivery(
          {
            tenantId: ctx.tenantId,
            orderId,
            orderItemId,
            quantity: dto.quantity,
            photoFileId: dto.photoFileId,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );
        await this.repository.insertDeliveryQrs(ctx.tenantId, delivery.id, orderItemId, qrLinks, tx);

        const movement = await this.stockRepository.insertMovement(
          {
            tenantId: ctx.tenantId,
            itemId: orderItem.itemId,
            location: DELIVERY_LOCATION,
            quantity: String(dto.quantity),
            type: 'SAIDA',
            reason: REASON_EXPEDITION_DELIVERY,
            photoFileId: dto.photoFileId,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );
        if (qrLinks.length > 0) {
          await this.stockRepository.insertMovementQrs(
            ctx.tenantId,
            movement.id,
            qrLinks.map((q) => ({
              qrValue: q.qrValue,
              boxQr: q.boxQr ?? undefined,
              homologationUnitId: q.homologationUnitId ?? undefined,
            })),
            tx,
          );
        }

        // Auto-status: all items delivered → PRONTO_ENTREGA, else PRODUZINDO.
        // Never regresses ENTREGUE_CLIENTE (unreachable here by the state
        // guard above — kept explicit for safety).
        const allItems = await this.repository.listItemsByOrders(ctx.tenantId, [orderId], tx);
        const afterDelivered = await this.repository.deliveredQuantities(ctx.tenantId, orderId, tx);
        const allDelivered = allItems.every((i) => (afterDelivered.get(i.id) ?? 0) >= i.quantity);
        const nextStatus: InvExpeditionStatus = allDelivered ? 'PRONTO_ENTREGA' : 'PRODUZINDO';
        let updated = order;
        let autoAdvanced = false;
        if (current !== 'ENTREGUE_CLIENTE' && current !== nextStatus) {
          updated =
            (await this.repository.updateOrder(
              ctx.tenantId,
              orderId,
              { status: nextStatus, updatedBy: ctx.userId ?? null },
              tx,
            )) ?? order;
          autoAdvanced = true;
        }

        // DEC-6: push "expedicao" enqueued in the same transaction.
        await this.repository.enqueuePush(
          ctx.tenantId,
          { qrCodes: qrLinks.map((q) => q.qrValue), location: 'expedicao' },
          tx,
        );

        const detail = await this.loadDetail(ctx, updated, tx);
        return {
          order: detail,
          delivery: {
            id: delivery.id,
            orderItemId,
            quantity: delivery.quantity,
            photoFileId: delivery.photoFileId,
            createdAt: toIso(delivery.createdAt),
          },
          movementId: movement.id,
          qrs: qrLinks.map((q) => ({ qrValue: q.qrValue, boxQr: q.boxQr ?? null })),
          autoAdvanced,
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  /**
   * stockOnly QR resolution (§M6): every code must exist in the homologation
   * registry (unit row, box row — expanded to its units — or registry UNIT
   * identity), belong to the expected item, and not be already used (latest
   * ledger event an exit, or any expedition baixa). Exactly one QR per unit.
   */
  private async resolveDeliveryQrs(
    tenantId: string,
    expectedItemId: string,
    quantity: number,
    codes: string[],
    tx: ExpeditionTx,
  ): Promise<NewDeliveryQrInput[]> {
    if (codes.length === 0) {
      throw new ValidationError('Baixa de item manufaturado exige exatamente 1 QR por unidade');
    }
    const normalized = codes.map((c) => normalizeQrInput(c));
    const seen = new Set<string>();
    for (const n of normalized) {
      if (seen.has(n.code)) throw new ValidationError(`QR duplicado na requisição: ${n.code}`);
      seen.add(n.code);
    }
    const allCandidates = [...new Set(normalized.flatMap((n) => n.candidates))];

    const [boxes, units, registry] = await Promise.all([
      this.homologationRepository.findBoxesByQrValues(tenantId, allCandidates, tx),
      this.homologationRepository.findUnitsByQrValues(tenantId, allCandidates, tx),
      this.homologationRepository.findRegistryByValues(tenantId, allCandidates, tx),
    ]);
    const boxUnits = await this.homologationRepository.unitsByHomologationIds(
      tenantId,
      boxes.map((b) => b.id),
      tx,
    );

    const resolved = normalized.flatMap((n) =>
      resolveOneQr(n, expectedItemId, { boxes, units, registry, boxUnits }),
    );

    // Duplicates after box expansion (unit scanned alongside its own box).
    const unitValues = resolved.map((r) => r.qrValue);
    const dupCheck = new Set<string>();
    for (const value of unitValues) {
      if (dupCheck.has(value)) throw new ValidationError(`QR duplicado após expansão de caixa: ${value}`);
      dupCheck.add(value);
    }

    // Exactly one QR per unit.
    if (resolved.length !== quantity) {
      throw new ValidationError(
        `Baixa de item manufaturado: quantidade (${quantity}) deve igualar o número de QRs (${resolved.length})`,
      );
    }

    await this.assertQrsUnused(tenantId, resolved, tx);
    return resolved;
  }

  /** Not already used: any expedition baixa, or latest ledger event an exit. */
  private async assertQrsUnused(
    tenantId: string,
    resolved: NewDeliveryQrInput[],
    tx: ExpeditionTx,
  ): Promise<void> {
    const unitValues = resolved.map((r) => r.qrValue);
    const boxValues = [...new Set(resolved.map((r) => r.boxQr).filter((v): v is string => !!v))];
    const usageValues = [...new Set([...unitValues, ...boxValues])];
    const [latestTypes, deliveryEvents] = await Promise.all([
      this.stockRepository.latestQrEventTypes(tenantId, unitValues, tx),
      this.homologationRepository.deliveryEventsByQrs(tenantId, usageValues, tx),
    ]);
    for (const r of resolved) {
      const usedInDelivery = deliveryEvents.some(
        (d) => d.qrValue === r.qrValue || (!!r.boxQr && d.boxQr === r.boxQr),
      );
      if (usedInDelivery) throw qrAlreadyUsed(r.qrValue);
      const lastType = latestTypes.get(r.qrValue);
      if (lastType && EXIT_TYPES.has(lastType)) throw qrAlreadyUsed(r.qrValue);
    }
  }

  // ---------------------------------------------------------------------------
  // Expedir (ship)
  // ---------------------------------------------------------------------------

  async ship(ctx: ExpeditionContext, orderId: string, dto: ShipExpeditionDTO): Promise<InvShipResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, orderId, tx);
        const current = order.status as InvExpeditionStatus;
        if (current === 'EM_TRANSITO') throw alreadyInState(current);
        const allowed = EXPEDITION_ORDER_TRANSITIONS[current] ?? [];
        if (!allowed.includes('EM_TRANSITO')) throw illegalTransition(current, allowed);

        const shipment = await this.repository.insertShipment(
          {
            tenantId: ctx.tenantId,
            orderId,
            address: dto.address,
            shippingMethod: dto.shippingMethod,
            responsible: dto.responsible,
            trackingCode: dto.trackingCode,
            proofFileId: dto.proofFileId,
            notes: dto.notes ?? null,
            createdBy: ctx.userId ?? null,
          },
          tx,
        );

        const updated = await this.repository.updateOrder(
          ctx.tenantId,
          orderId,
          { status: 'EM_TRANSITO', updatedBy: ctx.userId ?? null },
          tx,
        );

        // DEC-6: push "transporte" with every delivered unit QR.
        const qrRows = await this.repository.deliveredQrsByOrder(ctx.tenantId, orderId, tx);
        await this.repository.enqueuePush(
          ctx.tenantId,
          { qrCodes: uniqueQrValues(qrRows), location: 'transporte', technician: dto.responsible },
          tx,
        );

        return {
          order: await this.loadDetail(ctx, updated ?? order, tx),
          shipment: this.toShipmentResponse(shipment),
        };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Return / lost / found
  // ---------------------------------------------------------------------------

  async returnToExpedition(
    ctx: ExpeditionContext,
    orderId: string,
    dto: ReturnExpeditionDTO,
  ): Promise<InvExpeditionOrderDetailResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, orderId, tx);
        const current = order.status as InvExpeditionStatus;
        if (current === 'PRONTO_ENTREGA') throw alreadyInState(current);
        if (current !== 'EM_TRANSITO') {
          throw illegalTransition(current, EXPEDITION_ORDER_TRANSITIONS[current] ?? []);
        }

        const updated = await this.repository.updateOrder(
          ctx.tenantId,
          orderId,
          {
            status: 'PRONTO_ENTREGA',
            notes: stampNotes(order.notes, returnStamp(new Date().toISOString(), dto.reason)),
            updatedBy: ctx.userId ?? null,
          },
          tx,
        );

        const qrRows = await this.repository.deliveredQrsByOrder(ctx.tenantId, orderId, tx);
        await this.repository.enqueuePush(
          ctx.tenantId,
          { qrCodes: uniqueQrValues(qrRows), location: 'expedicao' },
          tx,
        );

        return this.loadDetail(ctx, updated ?? order, tx);
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async markLost(
    ctx: ExpeditionContext,
    orderId: string,
    dto: LostExpeditionDTO,
  ): Promise<InvExpeditionOrderDetailResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, orderId, tx);
        const current = order.status as InvExpeditionStatus;
        if (current === 'PERDIDO') throw alreadyInState(current);
        const allowed = EXPEDITION_ORDER_TRANSITIONS[current] ?? [];
        if (!allowed.includes('PERDIDO')) throw illegalTransition(current, allowed);

        const updated = await this.repository.updateOrder(
          ctx.tenantId,
          orderId,
          {
            status: 'PERDIDO',
            notes: stampNotes(order.notes, lostStamp(new Date().toISOString(), dto.reason)),
            updatedBy: ctx.userId ?? null,
          },
          tx,
        );

        const qrRows = await this.repository.deliveredQrsByOrder(ctx.tenantId, orderId, tx);
        await this.repository.enqueuePush(
          ctx.tenantId,
          { qrCodes: uniqueQrValues(qrRows), location: 'perdido' },
          tx,
        );

        return this.loadDetail(ctx, updated ?? order, tx);
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  async markFound(
    ctx: ExpeditionContext,
    orderId: string,
    dto: FoundExpeditionDTO,
  ): Promise<InvStatusChangeResponse> {
    try {
      return await this.repository.withTransaction(async (tx) => {
        const order = await this.lockOr404(ctx.tenantId, orderId, tx);
        const current = order.status as InvExpeditionStatus;
        if (current !== 'PERDIDO') {
          throw illegalTransition(current, EXPEDITION_ORDER_TRANSITIONS[current] ?? []);
        }

        const target = SECTOR_TO_STATUS[dto.sector];
        let unitProducts: InvUnitProductsSummary | undefined;
        if (dto.sector === 'CLIENTE') {
          unitProducts = await this.createUnitProductsForClient(ctx, order, tx);
        }

        const updated = await this.repository.updateOrder(
          ctx.tenantId,
          orderId,
          {
            status: target,
            notes: stampNotes(order.notes, foundStamp(new Date().toISOString(), dto.sector, dto.notes)),
            updatedBy: ctx.userId ?? null,
          },
          tx,
        );

        if (dto.sector !== 'CLIENTE') {
          // CLIENTE already pushed inside createUnitProductsForClient.
          const qrRows = await this.repository.deliveredQrsByOrder(ctx.tenantId, orderId, tx);
          await this.repository.enqueuePush(
            ctx.tenantId,
            { qrCodes: uniqueQrValues(qrRows), location: SECTOR_TO_PUSH[dto.sector] },
            tx,
          );
        }

        const detail = await this.loadDetail(ctx, updated ?? order, tx);
        return unitProducts ? { order: detail, unitProducts } : { order: detail };
      });
    } catch (err) {
      this.mapRepoError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Transit progress
  // ---------------------------------------------------------------------------

  async transitProgress(
    ctx: ExpeditionContext,
    orderId: string,
    page: number,
    pageSize: number,
  ): Promise<InvTransitProgressResponse> {
    const order = await this.repository.getById(ctx.tenantId, orderId);
    if (!order) throw new NotFoundError(`Expedition order ${orderId} not found`);

    const [items, qrRows] = await Promise.all([
      this.repository.listItemsByOrders(ctx.tenantId, [orderId]),
      this.repository.deliveredQrsByOrder(ctx.tenantId, orderId),
    ]);
    const codes = uniqueQrValues(qrRows);
    const states = await this.repository.externalStatesByCodes(ctx.tenantId, codes);
    const stateByCode = new Map<string, (typeof states)[number]>();
    for (const s of states) {
      stateByCode.set(s.code, s);
      if (s.qrValue) stateByCode.set(s.qrValue, s);
    }

    const byItem = new Map<string, InvTransitUnit[]>();
    let totalUnits = 0;
    let unitsInTransit = 0;
    for (const row of qrRows) {
      if (!row.qrValue) continue;
      const state = stateByCode.get(row.qrValue) ?? stateByCode.get(normalizeQrInput(row.qrValue).code) ?? null;
      // No mirror row = "em transporte" by default (§M6).
      const inTransit = !state || state.location === 'transporte';
      totalUnits += 1;
      if (inTransit) unitsInTransit += 1;
      const list = byItem.get(row.orderItemId) ?? [];
      list.push({
        qrValue: row.qrValue,
        inTransit,
        externalLocation: state?.location ?? null,
        externalStatus: state?.status ?? null,
      });
      byItem.set(row.orderItemId, list);
    }

    const perItem: InvTransitItemProgress[] = items
      .filter((i) => byItem.has(i.id))
      .map((i) => {
        const units = byItem.get(i.id) ?? [];
        return {
          orderItemId: i.id,
          itemId: i.itemId,
          itemName: i.itemName,
          total: units.length,
          inTransit: units.filter((u) => u.inTransit).length,
          units,
        };
      });

    const start = (page - 1) * pageSize;
    return {
      orderId,
      status: order.status as InvExpeditionStatus,
      totalUnits,
      unitsInTransit,
      summary: `${unitsInTransit} de ${totalUnits} em transporte`,
      items: perItem.slice(start, start + pageSize),
      page,
      pageSize,
      total: perItem.length,
      totalPages: Math.ceil(perItem.length / pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // §M4 demand resolution (A4 — POST /production/resolve-demand)
  // ---------------------------------------------------------------------------

  async resolveDemand(ctx: ExpeditionContext, dto: ResolveDemandDTO): Promise<InvResolveDemandResponse> {
    const order = await this.repository.getById(ctx.tenantId, dto.expeditionOrderId);
    if (!order) throw new NotFoundError(`Expedition order ${dto.expeditionOrderId} not found`);
    const items = await this.repository.listItemsByOrders(ctx.tenantId, [order.id]);
    const orderItemIds = items.map((i) => i.id);

    const [prodDemands, purchDemands] = await Promise.all([
      this.repository.findProductionDemandsByOrderItemIds(ctx.tenantId, orderItemIds),
      this.repository.findPurchaseDemandsByOrderItemIds(ctx.tenantId, orderItemIds),
    ]);
    const prodByItem = new Map(prodDemands.map((d) => [d.expeditionOrderItemId, d]));
    const purchByItem = new Map(purchDemands.map((d) => [d.expeditionOrderItemId, d]));

    const results: InvResolveDemandItemResult[] = [];
    try {
      for (const item of items) {
        results.push(
          await this.resolveDemandForItem(ctx, order, item, prodByItem.get(item.id), purchByItem.get(item.id)),
        );
      }
    } catch (err) {
      this.mapRepoError(err);
    }

    return { orderId: order.id, items: results };
  }

  private async resolveDemandForItem(
    ctx: ExpeditionContext,
    order: InvExpeditionOrderRow,
    item: OrderItemWithName,
    existingProd: { id: string } | undefined,
    existingPurch: { id: string; purchaseOrderId: string | null } | undefined,
  ): Promise<InvResolveDemandItemResult> {
    const totals = await this.stockRepository.getBalance(ctx.tenantId, item.itemId, DELIVERY_LOCATION);
    const balance = Number(totals.balance);
    const shortage = Math.max(0, Math.ceil(item.quantity - balance));
    const base = {
      orderItemId: item.id,
      itemId: item.itemId,
      itemName: item.itemName,
      required: item.quantity,
      balance,
      shortage,
    };

    if (shortage <= 0) return { ...base, action: 'NONE' };

    if (existingProd || existingPurch) {
      return {
        ...base,
        action: 'ALREADY_RESOLVED',
        productionDemandId: existingProd?.id,
        purchaseDemandId: existingPurch?.id,
        purchaseOrderId: existingPurch?.purchaseOrderId ?? undefined,
      };
    }

    if (item.isManufactured) {
      const demand = await this.repository.insertProductionDemand({
        tenantId: ctx.tenantId,
        expeditionOrderItemId: item.id,
        expeditionOrderId: order.id,
        itemId: item.itemId,
        quantity: shortage,
      });
      // null = a concurrent resolve claimed the UNIQUE first (idempotent).
      return demand
        ? { ...base, action: 'PRODUCTION_DEMAND', productionDemandId: demand.id }
        : { ...base, action: 'ALREADY_RESOLVED' };
    }

    // Purchasable: claim the UNIQUE first, then create the automatic PO.
    if (!order.projectId) {
      throw new ValidationError(
        'Pedido de expedição sem projeto — necessário para gerar o pedido de compra automático',
      );
    }
    const demand = await this.repository.insertPurchaseDemand({
      tenantId: ctx.tenantId,
      expeditionOrderItemId: item.id,
      expeditionOrderId: order.id,
      itemId: item.itemId,
      quantity: shortage,
    });
    if (!demand) return { ...base, action: 'ALREADY_RESOLVED' };

    const purchaseOrder = await this.purchaseOrderService.create(ctx, {
      projectId: order.projectId,
      itemId: item.itemId,
      quantity: shortage,
      recipient: AUTO_PURCHASE_RECIPIENT,
      deliveryPoint: AUTO_PURCHASE_DELIVERY_POINT,
      deadlineType: 'CUSTOMIZADO',
      deadlineDate: new Date(order.deliveryDate).toISOString(),
      requesterNotes: AUTO_PURCHASE_NOTE,
    });
    await this.repository.setPurchaseDemandOrder(ctx.tenantId, demand.id, purchaseOrder.id);
    return {
      ...base,
      action: 'PURCHASE_ORDER',
      purchaseDemandId: demand.id,
      purchaseOrderId: purchaseOrder.id,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async lockOr404(tenantId: string, id: string, tx: ExpeditionTx): Promise<InvExpeditionOrderRow> {
    const order = await this.repository.lockById(tenantId, id, tx);
    if (!order) throw new NotFoundError(`Expedition order ${id} not found`);
    return order;
  }

  private async assertItemsExist(tenantId: string, itemIds: string[]): Promise<void> {
    const found = await this.itemRepository.findByIds(tenantId, itemIds);
    const foundIds = new Set(found.map((i) => i.id));
    const missing = itemIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new ValidationError(`Itens não encontrados no catálogo: ${missing.join(', ')}`);
    }
  }

  /**
   * ENTREGUE_CLIENTE: one inv_unit_products row per delivered unit, labels
   * matched from the delivery QRs, "Projeto = Cliente" (client name = project
   * name; customer from the project when set), status PARADO. Idempotent —
   * labels already registered (this order or anywhere in the tenant) are
   * skipped, never recreated. Also enqueues the "cliente" push (DEC-6).
   */
  private async createUnitProductsForClient(
    ctx: ExpeditionContext,
    order: InvExpeditionOrderRow,
    tx: ExpeditionTx,
  ): Promise<InvUnitProductsSummary> {
    if (!order.projectId) {
      throw new ValidationError('Pedido sem projeto — a regra "Projeto = Cliente" exige um projeto para a entrega');
    }
    const project = await this.repository.getProject(ctx.tenantId, order.projectId, tx);
    if (!project) throw new ValidationError(`Project ${order.projectId} not found in tenant`);

    const qrRows = await this.repository.deliveredQrsByOrder(ctx.tenantId, order.id, tx);
    const byLabel = new Map<string, DeliveredQrRow>();
    for (const row of qrRows) {
      if (row.qrValue && !byLabel.has(row.qrValue)) byLabel.set(row.qrValue, row);
    }
    const labels = [...byLabel.keys()];
    const existing = await this.repository.existingUnitProductLabels(ctx.tenantId, labels, tx);
    const toCreate = labels.filter((l) => !existing.has(l));

    await this.repository.insertUnitProducts(
      toCreate.map((label) => ({
        tenantId: ctx.tenantId,
        itemId: byLabel.get(label)?.itemId ?? null,
        label,
        projectId: order.projectId,
        customerId: project.customerId ?? order.customerId ?? null,
        clientNameSnapshot: project.name,
        expeditionOrderId: order.id,
        createdBy: ctx.userId ?? null,
      })),
      tx,
    );

    await this.repository.enqueuePush(
      ctx.tenantId,
      { qrCodes: labels, location: 'cliente', clientName: project.name },
      tx,
    );

    return { created: toCreate.length, skipped: labels.length - toCreate.length, labels };
  }

  private async loadDetail(
    ctx: ExpeditionContext,
    order: InvExpeditionOrderRow,
    client?: ExpeditionTx,
  ): Promise<InvExpeditionOrderDetailResponse> {
    const items = await this.repository.listItemsByOrders(ctx.tenantId, [order.id], client);
    const delivered = await this.repository.deliveredQuantities(ctx.tenantId, order.id, client);
    return this.toDetail(order, items, delivered);
  }

  private toDetail(
    order: InvExpeditionOrderRow,
    items: OrderItemWithName[],
    delivered: Map<string, number>,
  ): InvExpeditionOrderDetailResponse {
    const status = order.status as InvExpeditionStatus;
    return {
      id: order.id,
      title: order.title ?? null,
      projectId: order.projectId ?? null,
      customerId: order.customerId ?? null,
      deliveryDate: toIso(order.deliveryDate),
      status,
      isReplacement: order.isReplacement,
      notes: order.notes ?? null,
      allowedTransitions: EXPEDITION_ORDER_TRANSITIONS[status] ?? [],
      createdAt: toIso(order.createdAt),
      updatedAt: toIso(order.updatedAt),
      items: items.map((i) => {
        const done = delivered.get(i.id) ?? 0;
        return {
          id: i.id,
          itemId: i.itemId,
          itemName: i.itemName,
          isManufactured: i.isManufactured,
          quantity: i.quantity,
          delivered: done,
          remaining: Math.max(0, i.quantity - done),
        };
      }),
    };
  }

  private toShipmentResponse(row: InvShipmentRow): InvShipmentResponse {
    return {
      id: row.id,
      orderId: row.orderId,
      address: row.address ?? null,
      shippingMethod: row.shippingMethod,
      responsible: row.responsible ?? null,
      trackingCode: row.trackingCode ?? null,
      proofFileId: row.proofFileId,
      notes: row.notes ?? null,
      createdAt: toIso(row.createdAt),
    };
  }

  // ---------------------------------------------------------------------------
  // Idempotency (best-effort, per-process — same M2/M4 pattern; durable
  // storage is the standing inv_idempotency_keys follow-up from the M2 PR).
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
    // A failed attempt must NOT poison the key — retries reuse it on purpose.
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
    for (const key of this.idempotencyCache.keys()) {
      if (this.idempotencyCache.size <= IDEMPOTENCY_MAX_ENTRIES) return;
      this.idempotencyCache.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Error mapping (Drizzle gotcha: the real SQLSTATE lives on `err.cause`)
  // ---------------------------------------------------------------------------

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
      throw new ValidationError('Referência inexistente (item, projeto, foto ou comprovante)');
    }
    if (code === '23514' || /check constraint/i.test(message)) {
      throw new ValidationError('Valor viola uma restrição do banco (quantidade/status/método)');
    }
    if (code === '40001' || code === '40P01') {
      throw new ConflictError('Conflito de concorrência — tente novamente');
    }
    throw err;
  }
}

/**
 * Resolve one scanned code to its delivery-QR link(s): a box QR expands to its
 * units; a homologation unit resolves directly; a registry-only UNIT identity
 * is accepted (same stockOnly semantics as the M5 validate); anything else →
 * INV_QR_NOT_IN_REGISTRY. Item mismatches → INV_QR_WRONG_ITEM.
 */
function resolveOneQr(
  n: { code: string; candidates: string[] },
  expectedItemId: string,
  lookups: {
    boxes: InvHomologationRow[];
    units: UnitWithHomologationRow[];
    registry: InvQrRegistryRow[];
    boxUnits: InvHomologationUnitRow[];
  },
): NewDeliveryQrInput[] {
  const inSet = (v: string | null | undefined): boolean => !!v && n.candidates.includes(v);

  const box = lookups.boxes.find((b) => inSet(b.boxQr));
  if (box) {
    if (box.itemId !== expectedItemId) throw qrWrongItem(n.code, expectedItemId);
    const contents = lookups.boxUnits.filter((u) => u.homologationId === box.id);
    if (contents.length === 0) {
      throw new InventoryError('INV_BOX_EMPTY', `Caixa ${n.code} não possui unidades`, 422, { boxQr: n.code });
    }
    return contents.map((u) => ({ qrValue: u.qrValue, boxQr: box.boxQr, homologationUnitId: u.id }));
  }

  const unit = lookups.units.find((u) => inSet(u.unit.qrValue));
  if (unit) {
    if (unit.homologation.itemId !== expectedItemId) throw qrWrongItem(n.code, expectedItemId);
    return [
      {
        qrValue: unit.unit.qrValue,
        boxQr: unit.homologation.boxQr ?? null,
        homologationUnitId: unit.unit.id,
      },
    ];
  }

  const registryRow = lookups.registry.find((r) => inSet(r.qrValue));
  if (registryRow && registryRow.kind === 'UNIT') {
    if (registryRow.itemId && registryRow.itemId !== expectedItemId) {
      throw qrWrongItem(n.code, expectedItemId);
    }
    return [{ qrValue: registryRow.qrValue, boxQr: null, homologationUnitId: null }];
  }
  throw qrNotInRegistry(n.code);
}

function toIso(value: Date | string | null | undefined): string {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function uniqueQrValues(rows: DeliveredQrRow[]): string[] {
  return [...new Set(rows.map((r) => r.qrValue).filter((v): v is string => !!v))];
}

export const inventoryExpeditionService = new InventoryExpeditionService();
