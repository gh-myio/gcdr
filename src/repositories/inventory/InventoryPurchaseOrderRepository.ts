// =============================================================================
// RFC-0061 M3 — Purchase orders repository (data access only).
//
// Owns `inv_purchase_orders` + `inv_purchase_order_events` +
// `inv_purchase_order_files`. Business rules (state machine, edit locks,
// receipt entry) live in InventoryPurchaseOrderService; every mutating method
// accepts an optional executor so the service composes order + events + files
// inside ONE transaction (same convention as InventoryStockRepository).
//
// The buyer-queue listing joins `inv_items` so `purchaseType`
// (NACIONAL/IMPORTACAO) can filter and ride on each row (§M3 buyer queue).
// =============================================================================

import { and, asc, desc, eq, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const {
  invPurchaseOrders,
  invPurchaseOrderEvents,
  invPurchaseOrderFiles,
  invStockMovements,
  invItems,
  fileAssets,
} = schema;

// -----------------------------------------------------------------------------
// Transaction typing (same derivation as InventoryStockRepository)
// -----------------------------------------------------------------------------

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
export type PurchaseOrderTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the root `db` client or an in-flight transaction. */
export type PurchaseOrderDbClient = typeof db | PurchaseOrderTx;

// -----------------------------------------------------------------------------
// Row & input types
// -----------------------------------------------------------------------------

export type InvPurchaseOrderRow = typeof invPurchaseOrders.$inferSelect;
export type InvPurchaseOrderEventRow = typeof invPurchaseOrderEvents.$inferSelect;
export type InvPurchaseOrderFileRow = typeof invPurchaseOrderFiles.$inferSelect;

/** Listing row: the order plus the item's purchase_type (buyer queue filter). */
export interface InvPurchaseOrderListRow {
  order: InvPurchaseOrderRow;
  purchaseType: string | null;
}

export interface NewPurchaseOrderInput {
  tenantId: string;
  projectId: string;
  requesterId?: string | null;
  itemId: string;
  itemNameSnapshot?: string | null;
  itemLink?: string | null;
  quantity: number;
  recipient?: string | null;
  deliveryPoint?: string | null;
  deadlineType?: string | null;
  deadlineDate?: Date | null;
  requesterNotes?: string | null;
  createdBy?: string | null;
}

/** Column patch for PATCH /purchase-orders/:id (service decides what goes in). */
export interface PurchaseOrderPatch {
  quantity?: number;
  recipient?: string | null;
  deliveryPoint?: string | null;
  deadlineType?: string | null;
  deadlineDate?: Date | null;
  requesterNotes?: string | null;
  buyerNotes?: string | null;
  passphrase?: string | null;
  deliveryForecast?: Date | null;
  status?: string;
  updatedBy?: string | null;
}

export interface NewPurchaseOrderEventInput {
  tenantId: string;
  orderId: string;
  actorId?: string | null;
  eventType: string; // CRIADO | STATUS_ALTERADO | OBSERVACAO_ATUALIZADA
  details?: Record<string, unknown>;
}

export interface PurchaseOrderListFilters {
  page: number;
  pageSize: number;
  status?: string;
  projectId?: string;
  purchaseType?: string;
  groupByProject?: boolean;
}

export class InventoryPurchaseOrderRepository {
  // ---------------------------------------------------------------------------
  // Transaction boundary
  // ---------------------------------------------------------------------------

  /** Runs `fn` inside one DB transaction (order + events + files). */
  async withTransaction<T>(fn: (tx: PurchaseOrderTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  private listConditions(tenantId: string, filters: PurchaseOrderListFilters): SQL[] {
    const conditions: SQL[] = [eq(invPurchaseOrders.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(invPurchaseOrders.status, filters.status));
    if (filters.projectId) conditions.push(eq(invPurchaseOrders.projectId, filters.projectId));
    if (filters.purchaseType) conditions.push(eq(invItems.purchaseType, filters.purchaseType));
    return conditions;
  }

  /**
   * Paginated listing joined with the catalog (purchase_type rides along for
   * the buyer queue). `groupByProject` orders by project first so the frontend
   * can render project sections without re-sorting.
   */
  async list(
    tenantId: string,
    filters: PurchaseOrderListFilters,
    client: PurchaseOrderDbClient = db,
  ): Promise<{ rows: InvPurchaseOrderListRow[]; total: number }> {
    const conditions = this.listConditions(tenantId, filters);
    const orderBy = filters.groupByProject
      ? [asc(invPurchaseOrders.projectId), desc(invPurchaseOrders.createdAt), desc(invPurchaseOrders.id)]
      : [desc(invPurchaseOrders.createdAt), desc(invPurchaseOrders.id)];

    const [rows, counts] = await Promise.all([
      client
        .select({ order: invPurchaseOrders, purchaseType: invItems.purchaseType })
        .from(invPurchaseOrders)
        .innerJoin(invItems, eq(invItems.id, invPurchaseOrders.itemId))
        .where(and(...conditions))
        .orderBy(...orderBy)
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize),
      client
        .select({ total: sql<number>`count(*)::int` })
        .from(invPurchaseOrders)
        .innerJoin(invItems, eq(invItems.id, invPurchaseOrders.itemId))
        .where(and(...conditions)),
    ]);

    return { rows, total: counts[0]?.total ?? 0 };
  }

  async getById(
    tenantId: string,
    id: string,
    client: PurchaseOrderDbClient = db,
  ): Promise<InvPurchaseOrderRow | null> {
    const [row] = await client
      .select()
      .from(invPurchaseOrders)
      .where(and(eq(invPurchaseOrders.tenantId, tenantId), eq(invPurchaseOrders.id, id)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Lock the order row for the whole transaction (`SELECT … FOR UPDATE`) so
   * concurrent status changes / edits serialize — the loser of a race sees the
   * winner's committed state and gets the correct 409 (AC-1).
   */
  async lockById(
    tenantId: string,
    id: string,
    client: PurchaseOrderDbClient,
  ): Promise<InvPurchaseOrderRow | null> {
    const [row] = await client
      .select()
      .from(invPurchaseOrders)
      .where(and(eq(invPurchaseOrders.tenantId, tenantId), eq(invPurchaseOrders.id, id)))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async insert(
    input: NewPurchaseOrderInput,
    client: PurchaseOrderDbClient = db,
  ): Promise<InvPurchaseOrderRow> {
    const [row] = await client
      .insert(invPurchaseOrders)
      .values({
        tenantId: input.tenantId,
        projectId: input.projectId,
        requesterId: input.requesterId ?? null,
        itemId: input.itemId,
        itemNameSnapshot: input.itemNameSnapshot ?? null,
        itemLink: input.itemLink ?? null,
        quantity: input.quantity,
        recipient: input.recipient ?? null,
        deliveryPoint: input.deliveryPoint ?? null,
        deadlineType: input.deadlineType ?? null,
        deadlineDate: input.deadlineDate ?? null,
        requesterNotes: input.requesterNotes ?? null,
        createdBy: input.createdBy ?? null,
        updatedBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  async update(
    tenantId: string,
    id: string,
    patch: PurchaseOrderPatch,
    client: PurchaseOrderDbClient = db,
  ): Promise<InvPurchaseOrderRow | null> {
    const { updatedBy, ...columns } = patch;
    const [row] = await client
      .update(invPurchaseOrders)
      .set({ ...columns, updatedAt: new Date(), updatedBy: updatedBy ?? null })
      .where(and(eq(invPurchaseOrders.tenantId, tenantId), eq(invPurchaseOrders.id, id)))
      .returning();
    return row ?? null;
  }

  /** Hard delete; events/files CASCADE, ledger FK is SET NULL. */
  async delete(tenantId: string, id: string, client: PurchaseOrderDbClient = db): Promise<boolean> {
    const rows = await client
      .delete(invPurchaseOrders)
      .where(and(eq(invPurchaseOrders.tenantId, tenantId), eq(invPurchaseOrders.id, id)))
      .returning({ id: invPurchaseOrders.id });
    return rows.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Events (WO-style timeline, DEC-9)
  // ---------------------------------------------------------------------------

  async insertEvent(
    input: NewPurchaseOrderEventInput,
    client: PurchaseOrderDbClient = db,
  ): Promise<InvPurchaseOrderEventRow> {
    const [row] = await client
      .insert(invPurchaseOrderEvents)
      .values({
        tenantId: input.tenantId,
        orderId: input.orderId,
        actorId: input.actorId ?? null,
        eventType: input.eventType,
        details: input.details ?? {},
      })
      .returning();
    return row;
  }

  /** Chronological (oldest-first) paginated timeline for GET /events. */
  async listEvents(
    tenantId: string,
    orderId: string,
    page: number,
    pageSize: number,
    client: PurchaseOrderDbClient = db,
  ): Promise<{ rows: InvPurchaseOrderEventRow[]; total: number }> {
    const where = and(
      eq(invPurchaseOrderEvents.tenantId, tenantId),
      eq(invPurchaseOrderEvents.orderId, orderId),
    );
    const [rows, counts] = await Promise.all([
      client
        .select()
        .from(invPurchaseOrderEvents)
        .where(where)
        .orderBy(asc(invPurchaseOrderEvents.createdAt), asc(invPurchaseOrderEvents.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      client
        .select({ total: sql<number>`count(*)::int` })
        .from(invPurchaseOrderEvents)
        .where(where),
    ]);
    return { rows, total: counts[0]?.total ?? 0 };
  }

  // ---------------------------------------------------------------------------
  // Files (link table → file_assets, annotation_attachments pattern)
  // ---------------------------------------------------------------------------

  /** Ids from `fileIds` that exist in the tenant and are not deleted. */
  async findExistingFileAssetIds(
    tenantId: string,
    fileIds: string[],
    client: PurchaseOrderDbClient = db,
  ): Promise<string[]> {
    if (fileIds.length === 0) return [];
    const rows = await client
      .select({ id: fileAssets.id })
      .from(fileAssets)
      .where(
        and(
          eq(fileAssets.tenantId, tenantId),
          inArray(fileAssets.id, fileIds),
          isNull(fileAssets.deletedAt),
        ),
      );
    return rows.map((r) => r.id);
  }

  async listFiles(
    tenantId: string,
    orderId: string,
    client: PurchaseOrderDbClient = db,
  ): Promise<InvPurchaseOrderFileRow[]> {
    return client
      .select()
      .from(invPurchaseOrderFiles)
      .where(
        and(
          eq(invPurchaseOrderFiles.tenantId, tenantId),
          eq(invPurchaseOrderFiles.orderId, orderId),
        ),
      )
      .orderBy(asc(invPurchaseOrderFiles.createdAt), asc(invPurchaseOrderFiles.id));
  }

  /** Insert links, skipping fileIds already linked (idempotent attach). */
  async insertFiles(
    tenantId: string,
    orderId: string,
    fileIds: string[],
    createdBy: string | null,
    client: PurchaseOrderDbClient = db,
  ): Promise<InvPurchaseOrderFileRow[]> {
    if (fileIds.length === 0) return [];
    const existing = await this.listFiles(tenantId, orderId, client);
    const linked = new Set(existing.map((f) => f.fileId));
    const fresh = [...new Set(fileIds)].filter((id) => !linked.has(id));
    if (fresh.length === 0) return [];
    return client
      .insert(invPurchaseOrderFiles)
      .values(fresh.map((fileId) => ({ tenantId, orderId, fileId, createdBy })))
      .returning();
  }

  /** Remove links for the given fileIds; returns how many were removed. */
  async deleteFiles(
    tenantId: string,
    orderId: string,
    fileIds: string[],
    client: PurchaseOrderDbClient = db,
  ): Promise<number> {
    if (fileIds.length === 0) return 0;
    const rows = await client
      .delete(invPurchaseOrderFiles)
      .where(
        and(
          eq(invPurchaseOrderFiles.tenantId, tenantId),
          eq(invPurchaseOrderFiles.orderId, orderId),
          inArray(invPurchaseOrderFiles.fileId, fileIds),
        ),
      )
      .returning({ id: invPurchaseOrderFiles.id });
    return rows.length;
  }

  // ---------------------------------------------------------------------------
  // Receipt-entry guard (A1)
  // ---------------------------------------------------------------------------

  /**
   * True when the exactly-one ENTRADA for this order already exists in the
   * ledger (partial UNIQUE (tenant_id, purchase_order_id) WHERE type='ENTRADA'
   * — migration 0067 `inv_stock_movements_po_entry_uq`).
   */
  async hasReceiptEntry(
    tenantId: string,
    orderId: string,
    client: PurchaseOrderDbClient = db,
  ): Promise<boolean> {
    const [row] = await client
      .select({ id: invStockMovements.id })
      .from(invStockMovements)
      .where(
        and(
          eq(invStockMovements.tenantId, tenantId),
          eq(invStockMovements.purchaseOrderId, orderId),
          eq(invStockMovements.type, 'ENTRADA'),
        ),
      )
      .limit(1);
    return !!row;
  }
}

export const inventoryPurchaseOrderRepository = new InventoryPurchaseOrderRepository();
