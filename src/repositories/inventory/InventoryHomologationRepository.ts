// =============================================================================
// RFC-0061 M5 — Homologation & QR repository (data access only).
//
// Owns `inv_homologations`, `inv_homologation_units` and `inv_qr_registry`
// (A2 — the single QR identity source: every QR value, unit or box, is
// inserted here once per tenant; the UNIQUE index gives cross box×unit
// duplicate detection by constraint). Also provides the read paths the QR
// services need over `inv_assembly_release_items` (remaining-to-homologate),
// `inv_movement_qrs` + `inv_stock_movements` (ledger events per QR),
// `inv_delivery_qrs` + `inv_item_deliveries` + `inv_expedition_orders`
// (expedition baixas — S5 trace) and `inv_expedition_order_items` (validate
// context resolution). All reads are tenant-scoped; every mutating method
// accepts an optional executor so the service composes them inside ONE
// transaction (same conventions as InventoryStockRepository).
// =============================================================================

import { and, asc, desc, eq, gt, inArray, like, or, sql, SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const {
  invItems,
  invQrRegistry,
  invHomologations,
  invHomologationUnits,
  invAssemblyReleaseItems,
  invMovementQrs,
  invStockMovements,
  invDeliveryQrs,
  invItemDeliveries,
  invExpeditionOrders,
  invExpeditionOrderItems,
} = schema;

// -----------------------------------------------------------------------------
// Transaction typing (same derivation as InventoryStockRepository)
// -----------------------------------------------------------------------------

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
export type HomologTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the root `db` client or an in-flight transaction. */
export type HomologDbClient = typeof db | HomologTx;

// -----------------------------------------------------------------------------
// Row & input types
// -----------------------------------------------------------------------------

export type InvItemRow = typeof invItems.$inferSelect;
export type InvQrRegistryRow = typeof invQrRegistry.$inferSelect;
export type InvHomologationRow = typeof invHomologations.$inferSelect;
export type InvHomologationUnitRow = typeof invHomologationUnits.$inferSelect;

export interface NewHomologationInput {
  tenantId: string;
  itemId: string;
  releaseId?: string | null;
  boxSize: number;
  boxQr?: string | null;
  responsibleId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface NewUnitInput {
  qrValue: string;
  position?: number | null;
}

export interface NewRegistryInput {
  qrValue: string;
  kind: 'UNIT' | 'BOX';
  itemId?: string | null;
  createdBy?: string | null;
}

export interface HomologationListFilters {
  itemId?: string;
  releaseId?: string;
  boxesOnly?: boolean;
}

/** One inv_movement_qrs link joined with its ledger movement (trace/validate). */
export interface QrMovementEventRow {
  qrValue: string | null;
  boxQr: string | null;
  movementId: string;
  type: string;
  location: string;
  quantity: string;
  reason: string | null;
  responsible: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** One inv_delivery_qrs link joined with its delivery (+ expedition order). */
export interface QrDeliveryEventRow {
  qrValue: string | null;
  boxQr: string | null;
  deliveryId: string;
  orderItemId: string;
  orderId: string | null;
  orderTitle: string | null;
  orderStatus: string | null;
  createdBy: string | null;
  createdAt: Date | null;
}

/** Homologation unit joined with its homologation (validate/trace lookups). */
export interface UnitWithHomologationRow {
  unit: InvHomologationUnitRow;
  homologation: InvHomologationRow;
}

export class InventoryHomologationRepository {
  // ---------------------------------------------------------------------------
  // Transaction boundary
  // ---------------------------------------------------------------------------

  async withTransaction<T>(fn: (tx: HomologTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  // ---------------------------------------------------------------------------
  // Catalog / releases (read-only helpers)
  // ---------------------------------------------------------------------------

  async getItem(tenantId: string, itemId: string, client: HomologDbClient = db): Promise<InvItemRow | null> {
    const [row] = await client
      .select()
      .from(invItems)
      .where(and(eq(invItems.tenantId, tenantId), eq(invItems.id, itemId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Total quantity released for (release, item) in inv_assembly_release_items.
   * `null` when the release has no row for the item (caller decides the error).
   */
  async releasedQuantity(
    tenantId: string,
    releaseId: string,
    itemId: string,
    client: HomologDbClient = db,
  ): Promise<number | null> {
    const [row] = await client
      .select({ total: sql<string | null>`sum(${invAssemblyReleaseItems.quantity})::text` })
      .from(invAssemblyReleaseItems)
      .where(
        and(
          eq(invAssemblyReleaseItems.tenantId, tenantId),
          eq(invAssemblyReleaseItems.releaseId, releaseId),
          eq(invAssemblyReleaseItems.itemId, itemId),
        ),
      );
    return row?.total === null || row?.total === undefined ? null : Number(row.total);
  }

  /** Units already homologated against (release, item) — remaining accounting. */
  async homologatedCount(
    tenantId: string,
    releaseId: string,
    itemId: string,
    client: HomologDbClient = db,
  ): Promise<number> {
    const [row] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invHomologationUnits)
      .innerJoin(invHomologations, eq(invHomologations.id, invHomologationUnits.homologationId))
      .where(
        and(
          eq(invHomologations.tenantId, tenantId),
          eq(invHomologations.releaseId, releaseId),
          eq(invHomologations.itemId, itemId),
        ),
      );
    return row?.total ?? 0;
  }

  /** Resolve an expedition-order item (validate context: orderItemId → itemId). */
  async getExpeditionOrderItem(
    tenantId: string,
    orderItemId: string,
    client: HomologDbClient = db,
  ): Promise<{ id: string; itemId: string; orderId: string } | null> {
    const [row] = await client
      .select({
        id: invExpeditionOrderItems.id,
        itemId: invExpeditionOrderItems.itemId,
        orderId: invExpeditionOrderItems.orderId,
      })
      .from(invExpeditionOrderItems)
      .where(and(eq(invExpeditionOrderItems.tenantId, tenantId), eq(invExpeditionOrderItems.id, orderItemId)))
      .limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // QR registry (A2)
  // ---------------------------------------------------------------------------

  async findRegistryByValues(
    tenantId: string,
    values: string[],
    client: HomologDbClient = db,
  ): Promise<InvQrRegistryRow[]> {
    if (values.length === 0) return [];
    return client
      .select()
      .from(invQrRegistry)
      .where(and(eq(invQrRegistry.tenantId, tenantId), inArray(invQrRegistry.qrValue, values)));
  }

  async insertRegistryRows(
    tenantId: string,
    rows: NewRegistryInput[],
    client: HomologDbClient = db,
  ): Promise<InvQrRegistryRow[]> {
    if (rows.length === 0) return [];
    return client
      .insert(invQrRegistry)
      .values(
        rows.map((r) => ({
          tenantId,
          qrValue: r.qrValue,
          kind: r.kind,
          itemId: r.itemId ?? null,
          createdBy: r.createdBy ?? null,
        })),
      )
      .returning();
  }

  /** Remove registry rows (e.g. an emptied box's QR ceases to exist). */
  async deleteRegistryByValues(
    tenantId: string,
    values: string[],
    client: HomologDbClient = db,
  ): Promise<number> {
    if (values.length === 0) return 0;
    const rows = await client
      .delete(invQrRegistry)
      .where(and(eq(invQrRegistry.tenantId, tenantId), inArray(invQrRegistry.qrValue, values)))
      .returning({ id: invQrRegistry.id });
    return rows.length;
  }

  // ---------------------------------------------------------------------------
  // Homologations & units
  // ---------------------------------------------------------------------------

  async insertHomologation(input: NewHomologationInput, client: HomologDbClient = db): Promise<InvHomologationRow> {
    const [row] = await client
      .insert(invHomologations)
      .values({
        tenantId: input.tenantId,
        itemId: input.itemId,
        releaseId: input.releaseId ?? null,
        boxSize: input.boxSize,
        boxQr: input.boxQr ?? null,
        responsibleId: input.responsibleId ?? null,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  async insertUnits(
    tenantId: string,
    homologationId: string,
    units: NewUnitInput[],
    client: HomologDbClient = db,
  ): Promise<InvHomologationUnitRow[]> {
    if (units.length === 0) return [];
    return client
      .insert(invHomologationUnits)
      .values(
        units.map((u, i) => ({
          tenantId,
          homologationId,
          qrValue: u.qrValue,
          position: u.position ?? i + 1,
        })),
      )
      .returning();
  }

  async getHomologationById(
    tenantId: string,
    id: string,
    client: HomologDbClient = db,
  ): Promise<InvHomologationRow | null> {
    const [row] = await client
      .select()
      .from(invHomologations)
      .where(and(eq(invHomologations.tenantId, tenantId), eq(invHomologations.id, id)))
      .limit(1);
    return row ?? null;
  }

  async getUnitById(
    tenantId: string,
    id: string,
    client: HomologDbClient = db,
  ): Promise<InvHomologationUnitRow | null> {
    const [row] = await client
      .select()
      .from(invHomologationUnits)
      .where(and(eq(invHomologationUnits.tenantId, tenantId), eq(invHomologationUnits.id, id)))
      .limit(1);
    return row ?? null;
  }

  async countUnits(homologationId: string, client: HomologDbClient = db): Promise<number> {
    const [row] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invHomologationUnits)
      .where(eq(invHomologationUnits.homologationId, homologationId));
    return row?.total ?? 0;
  }

  async unitsByHomologationIds(
    tenantId: string,
    ids: string[],
    client: HomologDbClient = db,
  ): Promise<InvHomologationUnitRow[]> {
    if (ids.length === 0) return [];
    return client
      .select()
      .from(invHomologationUnits)
      .where(and(eq(invHomologationUnits.tenantId, tenantId), inArray(invHomologationUnits.homologationId, ids)))
      .orderBy(asc(invHomologationUnits.position), asc(invHomologationUnits.createdAt));
  }

  /** Move a unit into another homologation (box ops). */
  async moveUnit(
    tenantId: string,
    unitId: string,
    newHomologationId: string,
    position: number | null,
    client: HomologDbClient = db,
  ): Promise<InvHomologationUnitRow | null> {
    const [row] = await client
      .update(invHomologationUnits)
      .set({ homologationId: newHomologationId, position })
      .where(and(eq(invHomologationUnits.tenantId, tenantId), eq(invHomologationUnits.id, unitId)))
      .returning();
    return row ?? null;
  }

  async deleteHomologation(tenantId: string, id: string, client: HomologDbClient = db): Promise<number> {
    const rows = await client
      .delete(invHomologations)
      .where(and(eq(invHomologations.tenantId, tenantId), eq(invHomologations.id, id)))
      .returning({ id: invHomologations.id });
    return rows.length;
  }

  /** Paginated homologation listing (newest first). */
  async list(
    tenantId: string,
    page: number,
    pageSize: number,
    filters: HomologationListFilters = {},
    client: HomologDbClient = db,
  ): Promise<{ rows: InvHomologationRow[]; total: number }> {
    const conditions: (SQL | undefined)[] = [eq(invHomologations.tenantId, tenantId)];
    if (filters.itemId) conditions.push(eq(invHomologations.itemId, filters.itemId));
    if (filters.releaseId) conditions.push(eq(invHomologations.releaseId, filters.releaseId));
    if (filters.boxesOnly) conditions.push(gt(invHomologations.boxSize, 1));
    const where = and(...conditions);

    const rows = await client
      .select()
      .from(invHomologations)
      .where(where)
      .orderBy(desc(invHomologations.createdAt), desc(invHomologations.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invHomologations)
      .where(where);
    return { rows, total: count?.total ?? 0 };
  }

  /**
   * Highest existing sequence for the auto-generated box-QR convention
   * `<prefix><seq>` (sequential per box-size prefix — §M5). Parsed in JS so a
   * foreign value under the prefix never breaks the query.
   */
  async maxBoxSeq(tenantId: string, prefix: string, client: HomologDbClient = db): Promise<number> {
    const rows = await client
      .select({ boxQr: invHomologations.boxQr })
      .from(invHomologations)
      .where(and(eq(invHomologations.tenantId, tenantId), like(invHomologations.boxQr, `${prefix}%`)));
    let max = 0;
    for (const row of rows) {
      const tail = row.boxQr?.slice(prefix.length) ?? '';
      if (/^\d+$/.test(tail)) max = Math.max(max, Number(tail));
    }
    return max;
  }

  // ---------------------------------------------------------------------------
  // QR lookups (validate S2 / trace S5)
  // ---------------------------------------------------------------------------

  /** Homologation units matching any of the candidate QR spellings. */
  async findUnitsByQrValues(
    tenantId: string,
    values: string[],
    client: HomologDbClient = db,
  ): Promise<UnitWithHomologationRow[]> {
    if (values.length === 0) return [];
    const rows = await client
      .select({ unit: invHomologationUnits, homologation: invHomologations })
      .from(invHomologationUnits)
      .innerJoin(invHomologations, eq(invHomologations.id, invHomologationUnits.homologationId))
      .where(and(eq(invHomologationUnits.tenantId, tenantId), inArray(invHomologationUnits.qrValue, values)));
    return rows;
  }

  /** Box homologations matching any of the candidate box-QR spellings. */
  async findBoxesByQrValues(
    tenantId: string,
    values: string[],
    client: HomologDbClient = db,
  ): Promise<InvHomologationRow[]> {
    if (values.length === 0) return [];
    return client
      .select()
      .from(invHomologations)
      .where(and(eq(invHomologations.tenantId, tenantId), inArray(invHomologations.boxQr, values)));
  }

  /**
   * Ledger events linked to any of the QR values — matched on the unit value
   * (`qr_value`) OR the box value (`box_qr`), oldest first (S5 timeline).
   */
  async movementEventsByQrs(
    tenantId: string,
    values: string[],
    client: HomologDbClient = db,
  ): Promise<QrMovementEventRow[]> {
    if (values.length === 0) return [];
    return client
      .select({
        qrValue: invMovementQrs.qrValue,
        boxQr: invMovementQrs.boxQr,
        movementId: invStockMovements.id,
        type: invStockMovements.type,
        location: invStockMovements.location,
        quantity: invStockMovements.quantity,
        reason: invStockMovements.reason,
        responsible: invStockMovements.responsible,
        createdBy: invStockMovements.createdBy,
        createdAt: invStockMovements.createdAt,
      })
      .from(invMovementQrs)
      .innerJoin(invStockMovements, eq(invStockMovements.id, invMovementQrs.movementId))
      .where(
        and(
          eq(invMovementQrs.tenantId, tenantId),
          or(inArray(invMovementQrs.qrValue, values), inArray(invMovementQrs.boxQr, values)),
        ),
      )
      .orderBy(asc(invStockMovements.createdAt), asc(invStockMovements.id));
  }

  /**
   * Expedition baixas linked to any of the QR values (unit or box spelling),
   * joined with the delivery and its order. Absent rows are normal (M6 is a
   * later phase) — callers must treat an empty result as "no baixa yet".
   */
  async deliveryEventsByQrs(
    tenantId: string,
    values: string[],
    client: HomologDbClient = db,
  ): Promise<QrDeliveryEventRow[]> {
    if (values.length === 0) return [];
    return client
      .select({
        qrValue: invDeliveryQrs.qrValue,
        boxQr: invDeliveryQrs.boxQr,
        deliveryId: invDeliveryQrs.deliveryId,
        orderItemId: invDeliveryQrs.orderItemId,
        orderId: invItemDeliveries.orderId,
        orderTitle: invExpeditionOrders.title,
        orderStatus: invExpeditionOrders.status,
        createdBy: invItemDeliveries.createdBy,
        createdAt: invItemDeliveries.createdAt,
      })
      .from(invDeliveryQrs)
      .innerJoin(invItemDeliveries, eq(invItemDeliveries.id, invDeliveryQrs.deliveryId))
      .leftJoin(invExpeditionOrders, eq(invExpeditionOrders.id, invItemDeliveries.orderId))
      .where(
        and(
          eq(invDeliveryQrs.tenantId, tenantId),
          or(inArray(invDeliveryQrs.qrValue, values), inArray(invDeliveryQrs.boxQr, values)),
        ),
      )
      .orderBy(asc(invItemDeliveries.createdAt), asc(invItemDeliveries.id));
  }
}

export const inventoryHomologationRepository = new InventoryHomologationRepository();
