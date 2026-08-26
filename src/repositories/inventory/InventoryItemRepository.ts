import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import { countWhere } from '../helpers/countQuery';

// =============================================================================
// RFC-0061 M1 — Catálogo & BOM data access (inv_items + inv_boms) and the
// aggregated per-location balance for GET /items/:id/stock (derived from
// inv_stock_movements — DEC-2, balance is NEVER stored).
//
// Query builders are exposed as public *Query methods so SQL-shape unit tests
// can assert them via PgDialect.sqlToQuery without a database (same pattern as
// CentralReplacementRepository.sql.test.ts).
// =============================================================================

const { invItems, invBoms, invStockMovements } = schema;

export type InvItemRow = typeof invItems.$inferSelect;
export type NewInvItemRow = typeof invItems.$inferInsert;
export type InvBomRow = typeof invBoms.$inferSelect;

export interface InvItemListFilter {
  page: number;
  pageSize: number;
  domain?: string;
  active?: boolean;
  q?: string;
}

export interface InvItemUpdatePatch {
  name?: string;
  link?: string | null;
  description?: string | null;
  isManufactured?: boolean;
  lossPercent?: string;
  lotQuantity?: number | null;
  purchaseType?: string | null;
  photoFileId?: string | null;
  active?: boolean;
}

export interface InvBomComponentRow {
  componentItemId: string;
  componentName: string;
  quantity: string;
}

export interface InvItemStockRow {
  location: string;
  totalIn: string;
  totalOut: string;
  balance: string;
  lastMovementAt: Date | null;
}

export class InventoryItemRepository {
  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  private listConditions(tenantId: string, filter: InvItemListFilter) {
    const conditions = [eq(invItems.tenantId, tenantId)];
    if (filter.domain) conditions.push(eq(invItems.domain, filter.domain));
    if (filter.active !== undefined) conditions.push(eq(invItems.active, filter.active));
    if (filter.q) conditions.push(ilike(invItems.name, `%${filter.q}%`));
    return conditions;
  }

  /** Paged list query (builder — asserted by the SQL-shape unit test). */
  listQuery(tenantId: string, filter: InvItemListFilter) {
    return db
      .select()
      .from(invItems)
      .where(and(...this.listConditions(tenantId, filter)))
      .orderBy(asc(invItems.name))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
  }

  async list(tenantId: string, filter: InvItemListFilter): Promise<{ items: InvItemRow[]; total: number }> {
    const [items, total] = await Promise.all([
      this.listQuery(tenantId, filter),
      countWhere(invItems, this.listConditions(tenantId, filter)),
    ]);
    return { items, total };
  }

  async getById(tenantId: string, id: string): Promise<InvItemRow | null> {
    const [row] = await db
      .select()
      .from(invItems)
      .where(and(eq(invItems.tenantId, tenantId), eq(invItems.id, id)))
      .limit(1);
    return row ?? null;
  }

  async create(data: NewInvItemRow): Promise<InvItemRow> {
    const [row] = await db.insert(invItems).values(data).returning();
    return row;
  }

  async update(
    tenantId: string,
    id: string,
    patch: InvItemUpdatePatch,
    updatedBy: string | null,
  ): Promise<InvItemRow | null> {
    const [row] = await db
      .update(invItems)
      .set({ ...patch, updatedAt: new Date(), updatedBy })
      .where(and(eq(invItems.tenantId, tenantId), eq(invItems.id, id)))
      .returning();
    return row ?? null;
  }

  /** Hard delete. FK RESTRICT from the ledger/purchase orders surfaces as 23503. */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const rows = await db
      .delete(invItems)
      .where(and(eq(invItems.tenantId, tenantId), eq(invItems.id, id)))
      .returning({ id: invItems.id });
    return rows.length > 0;
  }

  async findByIds(tenantId: string, ids: string[]): Promise<InvItemRow[]> {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(invItems)
      .where(and(eq(invItems.tenantId, tenantId), inArray(invItems.id, ids)));
  }

  // ---------------------------------------------------------------------------
  // BOM
  // ---------------------------------------------------------------------------

  /** BOM read query, joined with the component's catalog row (builder). */
  bomQuery(tenantId: string, productItemId: string) {
    return db
      .select({
        componentItemId: invBoms.componentItemId,
        componentName: invItems.name,
        quantity: invBoms.quantity,
      })
      .from(invBoms)
      .innerJoin(invItems, eq(invBoms.componentItemId, invItems.id))
      .where(and(eq(invBoms.tenantId, tenantId), eq(invBoms.productItemId, productItemId)))
      .orderBy(asc(invItems.name));
  }

  async getBom(tenantId: string, productItemId: string): Promise<InvBomComponentRow[]> {
    return this.bomQuery(tenantId, productItemId);
  }

  /**
   * PUT /items/:id/bom semantics — replace the WHOLE component list in one
   * transaction (delete-all + insert). An empty list clears the BOM.
   */
  async replaceBom(
    tenantId: string,
    productItemId: string,
    components: Array<{ componentItemId: string; quantity: string }>,
    createdBy: string | null,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(invBoms)
        .where(and(eq(invBoms.tenantId, tenantId), eq(invBoms.productItemId, productItemId)));

      if (components.length > 0) {
        await tx.insert(invBoms).values(
          components.map((c) => ({
            tenantId,
            productItemId,
            componentItemId: c.componentItemId,
            quantity: c.quantity,
            createdBy,
          })),
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Stock (aggregated balance per location — GET /items/:id/stock)
  // ---------------------------------------------------------------------------

  /**
   * Aggregate ledger query (builder — asserted by the SQL-shape unit test):
   * per location, SUM in-types, SUM out-types, balance = in − out, and the
   * last movement timestamp. AJUSTE adds (source semantics, §Data model).
   */
  stockByItemQuery(tenantId: string, itemId: string) {
    const totalIn = sql<string>`coalesce(sum(case when ${invStockMovements.type} in ('ENTRADA','AJUSTE','TRANSFERENCIA_IN') then ${invStockMovements.quantity} else 0 end), 0)`;
    const totalOut = sql<string>`coalesce(sum(case when ${invStockMovements.type} in ('SAIDA','TRANSFERENCIA_OUT') then ${invStockMovements.quantity} else 0 end), 0)`;
    const balance = sql<string>`coalesce(sum(case when ${invStockMovements.type} in ('ENTRADA','AJUSTE','TRANSFERENCIA_IN') then ${invStockMovements.quantity} else -${invStockMovements.quantity} end), 0)`;

    return db
      .select({
        location: invStockMovements.location,
        totalIn,
        totalOut,
        balance,
        lastMovementAt: sql<Date | null>`max(${invStockMovements.createdAt})`,
      })
      .from(invStockMovements)
      .where(and(eq(invStockMovements.tenantId, tenantId), eq(invStockMovements.itemId, itemId)))
      .groupBy(invStockMovements.location);
  }

  async getStockByItem(tenantId: string, itemId: string): Promise<InvItemStockRow[]> {
    return this.stockByItemQuery(tenantId, itemId);
  }
}

// Singleton (repo layer convention).
export const inventoryItemRepository = new InventoryItemRepository();
