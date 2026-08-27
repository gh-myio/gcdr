// =============================================================================
// RFC-0061 M6 — Expedition repository (data access only).
//
// Owns `inv_expedition_orders`, `inv_expedition_order_items`,
// `inv_item_deliveries`, `inv_delivery_qrs`, `inv_shipments`,
// `inv_unit_products` (creation on ENTREGUE_CLIENTE), the two demand tables
// (`inv_production_demands`, `inv_purchase_demands` — §M4 demand resolution
// ships with M6, A4), the read path over `inv_external_states` (transit
// progress) and the `inv_external_push_outbox` enqueue (DEC-6 — rows are
// inserted in the SAME transaction as the domain write; the drain worker is
// M8).
//
// Conventions (matched from InventoryStockRepository / InventoryProduction-
// Repository): shared `db` client, tenant-scoped reads, every mutating method
// accepts an optional executor so the service composes them inside ONE
// transaction; `withTransaction` exposes the boundary; FOR UPDATE row lock on
// the order serializes concurrent transitions (DEC-4).
// =============================================================================

import { and, asc, desc, eq, inArray, or, sql, SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import type { StockTx, StockDbClient } from './InventoryStockRepository';

const {
  invItems,
  invProjects,
  invExpeditionOrders,
  invExpeditionOrderItems,
  invItemDeliveries,
  invDeliveryQrs,
  invShipments,
  invUnitProducts,
  invProductionDemands,
  invPurchaseDemands,
  invExternalStates,
  invExternalPushOutbox,
} = schema;

// -----------------------------------------------------------------------------
// Transaction typing (same derivation as InventoryStockRepository)
// -----------------------------------------------------------------------------

export type ExpeditionTx = StockTx;
export type ExpeditionDbClient = StockDbClient;

// -----------------------------------------------------------------------------
// Row & input types
// -----------------------------------------------------------------------------

export type InvExpeditionOrderRow = typeof invExpeditionOrders.$inferSelect;
export type InvExpeditionOrderItemRow = typeof invExpeditionOrderItems.$inferSelect;
export type InvItemDeliveryRow = typeof invItemDeliveries.$inferSelect;
export type InvDeliveryQrRow = typeof invDeliveryQrs.$inferSelect;
export type InvShipmentRow = typeof invShipments.$inferSelect;
export type InvUnitProductRow = typeof invUnitProducts.$inferSelect;
export type InvProductionDemandRow = typeof invProductionDemands.$inferSelect;
export type InvPurchaseDemandRow = typeof invPurchaseDemands.$inferSelect;
export type InvProjectRow = typeof invProjects.$inferSelect;

export interface NewExpeditionOrderInput {
  tenantId: string;
  title?: string | null;
  projectId: string;
  customerId?: string | null;
  deliveryDate: Date;
  isReplacement?: boolean;
  notes?: string | null;
  createdBy?: string | null;
}

export interface ExpeditionOrderPatch {
  title?: string | null;
  projectId?: string;
  customerId?: string | null;
  deliveryDate?: Date;
  isReplacement?: boolean;
  notes?: string | null;
  status?: string;
  updatedBy?: string | null;
}

export interface NewOrderItemInput {
  tenantId: string;
  orderId: string;
  itemId: string;
  quantity: number;
}

export interface OrderItemWithName {
  id: string;
  orderId: string;
  itemId: string;
  itemName: string;
  isManufactured: boolean;
  domain: string;
  quantity: number;
}

export interface ExpeditionListFilters {
  status?: string;
  projectId?: string;
}

export interface NewDeliveryInput {
  tenantId: string;
  orderId: string;
  orderItemId: string;
  quantity: number;
  photoFileId: string;
  createdBy?: string | null;
}

export interface NewDeliveryQrInput {
  qrValue: string;
  boxQr?: string | null;
  homologationUnitId?: string | null;
}

export interface NewShipmentInput {
  tenantId: string;
  orderId: string;
  address: string;
  shippingMethod: string;
  responsible: string;
  trackingCode: string;
  proofFileId: string;
  notes?: string | null;
  createdBy?: string | null;
}

export interface NewUnitProductInput {
  tenantId: string;
  itemId: string | null;
  label: string;
  projectId: string | null;
  customerId: string | null;
  clientNameSnapshot: string | null;
  expeditionOrderId: string;
  createdBy?: string | null;
}

/** One delivered QR joined with its order item (labels for unit products). */
export interface DeliveredQrRow {
  orderItemId: string;
  itemId: string;
  qrValue: string | null;
  boxQr: string | null;
  homologationUnitId: string | null;
}

export interface ExternalStateLiteRow {
  code: string;
  qrValue: string | null;
  location: string | null;
  status: string | null;
}

export interface NewPushOutboxInput {
  qrCodes: string[];
  location: string;
  technician?: string | null;
  clientName?: string | null;
}

export interface NewProductionDemandInput {
  tenantId: string;
  expeditionOrderItemId: string;
  expeditionOrderId: string;
  itemId: string;
  quantity: number;
}

export interface NewPurchaseDemandInput {
  tenantId: string;
  expeditionOrderItemId: string;
  expeditionOrderId: string;
  itemId: string;
  quantity: number;
  purchaseOrderId?: string | null;
}

export class InventoryExpeditionRepository {
  // ---------------------------------------------------------------------------
  // Transaction boundary
  // ---------------------------------------------------------------------------

  async withTransaction<T>(fn: (tx: ExpeditionTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  async list(
    tenantId: string,
    page: number,
    pageSize: number,
    filters: ExpeditionListFilters = {},
    client: ExpeditionDbClient = db,
  ): Promise<{ rows: InvExpeditionOrderRow[]; total: number }> {
    const conditions: (SQL | undefined)[] = [eq(invExpeditionOrders.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(invExpeditionOrders.status, filters.status));
    if (filters.projectId) conditions.push(eq(invExpeditionOrders.projectId, filters.projectId));
    const where = and(...conditions);

    const rows = await client
      .select()
      .from(invExpeditionOrders)
      .where(where)
      .orderBy(desc(invExpeditionOrders.createdAt), desc(invExpeditionOrders.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invExpeditionOrders)
      .where(where);
    return { rows, total: count?.total ?? 0 };
  }

  async getById(
    tenantId: string,
    id: string,
    client: ExpeditionDbClient = db,
  ): Promise<InvExpeditionOrderRow | null> {
    const [row] = await client
      .select()
      .from(invExpeditionOrders)
      .where(and(eq(invExpeditionOrders.tenantId, tenantId), eq(invExpeditionOrders.id, id)))
      .limit(1);
    return row ?? null;
  }

  /** FOR UPDATE lock — serializes concurrent transitions/deliveries (DEC-4). */
  async lockById(tenantId: string, id: string, tx: ExpeditionTx): Promise<InvExpeditionOrderRow | null> {
    const [row] = await tx
      .select()
      .from(invExpeditionOrders)
      .where(and(eq(invExpeditionOrders.tenantId, tenantId), eq(invExpeditionOrders.id, id)))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async insertOrder(input: NewExpeditionOrderInput, client: ExpeditionDbClient = db): Promise<InvExpeditionOrderRow> {
    const [row] = await client
      .insert(invExpeditionOrders)
      .values({
        tenantId: input.tenantId,
        title: input.title ?? null,
        projectId: input.projectId,
        customerId: input.customerId ?? null,
        deliveryDate: input.deliveryDate,
        isReplacement: input.isReplacement ?? false,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
        updatedBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  async updateOrder(
    tenantId: string,
    id: string,
    patch: ExpeditionOrderPatch,
    client: ExpeditionDbClient = db,
  ): Promise<InvExpeditionOrderRow | null> {
    const [row] = await client
      .update(invExpeditionOrders)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(invExpeditionOrders.tenantId, tenantId), eq(invExpeditionOrders.id, id)))
      .returning();
    return row ?? null;
  }

  /** Hard delete — items/deliveries/QRs/shipments CASCADE by schema. */
  async deleteOrder(tenantId: string, id: string, client: ExpeditionDbClient = db): Promise<boolean> {
    const rows = await client
      .delete(invExpeditionOrders)
      .where(and(eq(invExpeditionOrders.tenantId, tenantId), eq(invExpeditionOrders.id, id)))
      .returning({ id: invExpeditionOrders.id });
    return rows.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Order items
  // ---------------------------------------------------------------------------

  async listItemsByOrders(
    tenantId: string,
    orderIds: string[],
    client: ExpeditionDbClient = db,
  ): Promise<OrderItemWithName[]> {
    if (orderIds.length === 0) return [];
    return client
      .select({
        id: invExpeditionOrderItems.id,
        orderId: invExpeditionOrderItems.orderId,
        itemId: invExpeditionOrderItems.itemId,
        itemName: invItems.name,
        isManufactured: invItems.isManufactured,
        domain: invItems.domain,
        quantity: invExpeditionOrderItems.quantity,
      })
      .from(invExpeditionOrderItems)
      .innerJoin(invItems, eq(invItems.id, invExpeditionOrderItems.itemId))
      .where(and(eq(invExpeditionOrderItems.tenantId, tenantId), inArray(invExpeditionOrderItems.orderId, orderIds)))
      .orderBy(asc(invItems.name), asc(invExpeditionOrderItems.id));
  }

  async getOrderItem(
    tenantId: string,
    orderItemId: string,
    client: ExpeditionDbClient = db,
  ): Promise<OrderItemWithName | null> {
    const [row] = await client
      .select({
        id: invExpeditionOrderItems.id,
        orderId: invExpeditionOrderItems.orderId,
        itemId: invExpeditionOrderItems.itemId,
        itemName: invItems.name,
        isManufactured: invItems.isManufactured,
        domain: invItems.domain,
        quantity: invExpeditionOrderItems.quantity,
      })
      .from(invExpeditionOrderItems)
      .innerJoin(invItems, eq(invItems.id, invExpeditionOrderItems.itemId))
      .where(and(eq(invExpeditionOrderItems.tenantId, tenantId), eq(invExpeditionOrderItems.id, orderItemId)))
      .limit(1);
    return row ?? null;
  }

  async insertItems(
    rows: NewOrderItemInput[],
    client: ExpeditionDbClient = db,
  ): Promise<InvExpeditionOrderItemRow[]> {
    if (rows.length === 0) return [];
    return client.insert(invExpeditionOrderItems).values(rows).returning();
  }

  /** PATCH item replace: wipes the order's items (deliveries CASCADE with them). */
  async deleteItemsByOrder(tenantId: string, orderId: string, client: ExpeditionDbClient = db): Promise<number> {
    const rows = await client
      .delete(invExpeditionOrderItems)
      .where(and(eq(invExpeditionOrderItems.tenantId, tenantId), eq(invExpeditionOrderItems.orderId, orderId)))
      .returning({ id: invExpeditionOrderItems.id });
    return rows.length;
  }

  // ---------------------------------------------------------------------------
  // Deliveries (baixa/separação)
  // ---------------------------------------------------------------------------

  /** Σ delivered per order item (drives auto-status + the "disponível" guard). */
  async deliveredQuantities(
    tenantId: string,
    orderId: string,
    client: ExpeditionDbClient = db,
  ): Promise<Map<string, number>> {
    const rows = await client
      .select({
        orderItemId: invItemDeliveries.orderItemId,
        total: sql<number>`coalesce(sum(${invItemDeliveries.quantity}), 0)::int`,
      })
      .from(invItemDeliveries)
      .where(and(eq(invItemDeliveries.tenantId, tenantId), eq(invItemDeliveries.orderId, orderId)))
      .groupBy(invItemDeliveries.orderItemId);
    return new Map(rows.map((r) => [r.orderItemId, r.total]));
  }

  async insertDelivery(input: NewDeliveryInput, client: ExpeditionDbClient = db): Promise<InvItemDeliveryRow> {
    const [row] = await client
      .insert(invItemDeliveries)
      .values({
        tenantId: input.tenantId,
        orderId: input.orderId,
        orderItemId: input.orderItemId,
        quantity: input.quantity,
        photoFileId: input.photoFileId,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  async insertDeliveryQrs(
    tenantId: string,
    deliveryId: string,
    orderItemId: string,
    qrs: NewDeliveryQrInput[],
    client: ExpeditionDbClient = db,
  ): Promise<InvDeliveryQrRow[]> {
    if (qrs.length === 0) return [];
    return client
      .insert(invDeliveryQrs)
      .values(
        qrs.map((q) => ({
          tenantId,
          deliveryId,
          orderItemId,
          qrValue: q.qrValue,
          boxQr: q.boxQr ?? null,
          homologationUnitId: q.homologationUnitId ?? null,
        })),
      )
      .returning();
  }

  /** All delivered QRs of one order, joined with the order item (labels). */
  async deliveredQrsByOrder(
    tenantId: string,
    orderId: string,
    client: ExpeditionDbClient = db,
  ): Promise<DeliveredQrRow[]> {
    return client
      .select({
        orderItemId: invDeliveryQrs.orderItemId,
        itemId: invExpeditionOrderItems.itemId,
        qrValue: invDeliveryQrs.qrValue,
        boxQr: invDeliveryQrs.boxQr,
        homologationUnitId: invDeliveryQrs.homologationUnitId,
      })
      .from(invDeliveryQrs)
      .innerJoin(invItemDeliveries, eq(invItemDeliveries.id, invDeliveryQrs.deliveryId))
      .innerJoin(invExpeditionOrderItems, eq(invExpeditionOrderItems.id, invDeliveryQrs.orderItemId))
      .where(and(eq(invDeliveryQrs.tenantId, tenantId), eq(invItemDeliveries.orderId, orderId)))
      .orderBy(asc(invItemDeliveries.createdAt), asc(invDeliveryQrs.id));
  }

  // ---------------------------------------------------------------------------
  // Shipments
  // ---------------------------------------------------------------------------

  async insertShipment(input: NewShipmentInput, client: ExpeditionDbClient = db): Promise<InvShipmentRow> {
    const [row] = await client
      .insert(invShipments)
      .values({
        tenantId: input.tenantId,
        orderId: input.orderId,
        address: input.address,
        shippingMethod: input.shippingMethod,
        responsible: input.responsible,
        trackingCode: input.trackingCode,
        proofFileId: input.proofFileId,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  async listShipments(
    tenantId: string,
    orderId: string,
    client: ExpeditionDbClient = db,
  ): Promise<InvShipmentRow[]> {
    return client
      .select()
      .from(invShipments)
      .where(and(eq(invShipments.tenantId, tenantId), eq(invShipments.orderId, orderId)))
      .orderBy(desc(invShipments.createdAt), desc(invShipments.id));
  }

  // ---------------------------------------------------------------------------
  // Unit products (ENTREGUE_CLIENTE — M7 table, creation owned by M6)
  // ---------------------------------------------------------------------------

  /** Labels already taken tenant-wide among the candidates (unique per tenant). */
  async existingUnitProductLabels(
    tenantId: string,
    labels: string[],
    client: ExpeditionDbClient = db,
  ): Promise<Set<string>> {
    if (labels.length === 0) return new Set();
    const rows = await client
      .select({ label: invUnitProducts.label })
      .from(invUnitProducts)
      .where(and(eq(invUnitProducts.tenantId, tenantId), inArray(invUnitProducts.label, labels)));
    return new Set(rows.map((r) => r.label).filter((l): l is string => !!l));
  }

  async insertUnitProducts(
    rows: NewUnitProductInput[],
    client: ExpeditionDbClient = db,
  ): Promise<InvUnitProductRow[]> {
    if (rows.length === 0) return [];
    return client
      .insert(invUnitProducts)
      .values(
        rows.map((r) => ({
          tenantId: r.tenantId,
          itemId: r.itemId,
          label: r.label,
          status: 'PARADO',
          projectId: r.projectId,
          customerId: r.customerId,
          clientNameSnapshot: r.clientNameSnapshot,
          expeditionOrderId: r.expeditionOrderId,
          createdBy: r.createdBy ?? null,
        })),
      )
      .returning();
  }

  // ---------------------------------------------------------------------------
  // Projects (read-only helper — "Projeto = Cliente" rule)
  // ---------------------------------------------------------------------------

  async getProject(tenantId: string, id: string, client: ExpeditionDbClient = db): Promise<InvProjectRow | null> {
    const [row] = await client
      .select()
      .from(invProjects)
      .where(and(eq(invProjects.tenantId, tenantId), eq(invProjects.id, id)))
      .limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // External states (transit progress) + push outbox (DEC-6)
  // ---------------------------------------------------------------------------

  /** Mirror rows matching any candidate spelling (code or qr_value). */
  async externalStatesByCodes(
    tenantId: string,
    values: string[],
    client: ExpeditionDbClient = db,
  ): Promise<ExternalStateLiteRow[]> {
    if (values.length === 0) return [];
    return client
      .select({
        code: invExternalStates.code,
        qrValue: invExternalStates.qrValue,
        location: invExternalStates.location,
        status: invExternalStates.status,
      })
      .from(invExternalStates)
      .where(
        and(
          eq(invExternalStates.tenantId, tenantId),
          or(inArray(invExternalStates.code, values), inArray(invExternalStates.qrValue, values)),
        ),
      );
  }

  /** Enqueue one push-outbox row IN the caller's transaction (DEC-6). */
  async enqueuePush(
    tenantId: string,
    input: NewPushOutboxInput,
    client: ExpeditionDbClient = db,
  ): Promise<void> {
    if (input.qrCodes.length === 0) return;
    await client.insert(invExternalPushOutbox).values({
      tenantId,
      qrCodes: input.qrCodes,
      location: input.location,
      technician: input.technician ?? null,
      clientName: input.clientName ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Demand resolution (§M4, A4 — idempotent per expedition_order_item_id)
  // ---------------------------------------------------------------------------

  async findProductionDemandsByOrderItemIds(
    tenantId: string,
    orderItemIds: string[],
    client: ExpeditionDbClient = db,
  ): Promise<InvProductionDemandRow[]> {
    if (orderItemIds.length === 0) return [];
    return client
      .select()
      .from(invProductionDemands)
      .where(
        and(
          eq(invProductionDemands.tenantId, tenantId),
          inArray(invProductionDemands.expeditionOrderItemId, orderItemIds),
        ),
      );
  }

  async findPurchaseDemandsByOrderItemIds(
    tenantId: string,
    orderItemIds: string[],
    client: ExpeditionDbClient = db,
  ): Promise<InvPurchaseDemandRow[]> {
    if (orderItemIds.length === 0) return [];
    return client
      .select()
      .from(invPurchaseDemands)
      .where(
        and(
          eq(invPurchaseDemands.tenantId, tenantId),
          inArray(invPurchaseDemands.expeditionOrderItemId, orderItemIds),
        ),
      );
  }

  /** Idempotent insert — the UNIQUE(order_item) makes replays a no-op (null). */
  async insertProductionDemand(
    input: NewProductionDemandInput,
    client: ExpeditionDbClient = db,
  ): Promise<InvProductionDemandRow | null> {
    const [row] = await client
      .insert(invProductionDemands)
      .values({
        tenantId: input.tenantId,
        expeditionOrderItemId: input.expeditionOrderItemId,
        expeditionOrderId: input.expeditionOrderId,
        itemId: input.itemId,
        quantity: input.quantity,
      })
      .onConflictDoNothing({ target: invProductionDemands.expeditionOrderItemId })
      .returning();
    return row ?? null;
  }

  /** Idempotent insert — claims the UNIQUE before the automatic PO exists. */
  async insertPurchaseDemand(
    input: NewPurchaseDemandInput,
    client: ExpeditionDbClient = db,
  ): Promise<InvPurchaseDemandRow | null> {
    const [row] = await client
      .insert(invPurchaseDemands)
      .values({
        tenantId: input.tenantId,
        expeditionOrderItemId: input.expeditionOrderItemId,
        expeditionOrderId: input.expeditionOrderId,
        itemId: input.itemId,
        quantity: input.quantity,
        purchaseOrderId: input.purchaseOrderId ?? null,
      })
      .onConflictDoNothing({ target: invPurchaseDemands.expeditionOrderItemId })
      .returning();
    return row ?? null;
  }

  async setPurchaseDemandOrder(
    tenantId: string,
    demandId: string,
    purchaseOrderId: string,
    client: ExpeditionDbClient = db,
  ): Promise<void> {
    await client
      .update(invPurchaseDemands)
      .set({ purchaseOrderId })
      .where(and(eq(invPurchaseDemands.tenantId, tenantId), eq(invPurchaseDemands.id, demandId)));
  }
}

export const inventoryExpeditionRepository = new InventoryExpeditionRepository();
