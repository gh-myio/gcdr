// =============================================================================
// RFC-0061 M4 — Produção data access (inv_production_demands,
// inv_assembly_releases + items + issues) plus the read-only views M4 needs
// over the catalog/BOM (inv_boms, inv_items), the homologation floor
// (inv_homologations + inv_homologation_units — read-only, M5 owns writes)
// and derived component balances (inv_stock_movements — DEC-2).
//
// Conventions (matched from InventoryStockRepository): shared `db` client,
// tenant-scoped reads, every mutating method accepts an optional executor so
// the service composes them inside ONE transaction; `withTransaction` exposes
// the boundary. Component stock movements themselves are written through the
// M2 repository (composed with the same executor) — this file never inserts
// into inv_stock_movements.
//
// Query builders are public so SQL-shape tests can assert the generated SQL
// (PgDialect.sqlToQuery) without a database.
// =============================================================================

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';
import type { StockDbClient, StockTx } from './InventoryStockRepository';

const {
  invItems,
  invBoms,
  invProductionDemands,
  invAssemblyReleases,
  invAssemblyReleaseItems,
  invAssemblyReleaseIssues,
  invHomologations,
  invHomologationUnits,
  invStockMovements,
} = schema;

// Re-export the transaction typing so the service deals with ONE client type
// when composing this repository with the M2 stock repository.
export type ProductionTx = StockTx;
export type ProductionDbClient = StockDbClient;

// -----------------------------------------------------------------------------
// Row & input types
// -----------------------------------------------------------------------------

export type InvProductionDemandRow = typeof invProductionDemands.$inferSelect;
export type InvAssemblyReleaseRow = typeof invAssemblyReleases.$inferSelect;
export type InvAssemblyReleaseItemRow = typeof invAssemblyReleaseItems.$inferSelect;
export type InvAssemblyReleaseIssueRow = typeof invAssemblyReleaseIssues.$inferSelect;

export interface NewReleaseInput {
  tenantId: string;
  photoFileId: string;
  responsibles: string[];
  notes?: string | null;
  createdBy?: string | null;
}

export interface NewReleaseItemInput {
  tenantId: string;
  releaseId: string;
  itemId: string;
  quantity: number;
}

export interface NewIssueInput {
  tenantId: string;
  releaseId: string;
  releaseItemId?: string | null;
  itemId?: string | null;
  reportedQuantity?: number | null;
  message?: string | null;
  reportedBy?: string | null;
}

/** One row of GET /production/demands (grouped by product — DEC-5 FK). */
export interface DemandGroupRow {
  itemId: string;
  itemName: string;
  totalQuantity: number;
  demandCount: number;
  oldestCreatedAt: Date | null;
  /** Derived ALMOXARIFADO ("Estoque Myio") balance — numeric as string. */
  almoxarifadoBalance: string;
}

/** Release item joined with its catalog name. */
export interface ReleaseItemWithName {
  id: string;
  itemId: string;
  itemName: string;
  quantity: number;
}

/** BOM row for explosion/capacity: component + its loss percent (inv_items). */
export interface BomExplosionRow {
  productItemId: string;
  componentItemId: string;
  componentName: string;
  /** numeric(12,3) as string */
  quantity: string;
  /** component's inv_items.loss_percent as string */
  lossPercent: string;
}

export interface ComponentBalanceRow {
  itemId: string;
  balance: string;
}

export interface HomologatedCountRow {
  itemId: string;
  homologatedCount: number;
}

export class InventoryProductionRepository {
  // ---------------------------------------------------------------------------
  // Transaction boundary
  // ---------------------------------------------------------------------------

  async withTransaction<T>(fn: (tx: ProductionTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  // ---------------------------------------------------------------------------
  // Fila de Produção (production demands)
  // ---------------------------------------------------------------------------

  /**
   * Pending demands grouped by product with the derived ALMOXARIFADO balance
   * side-by-side (§M4 "Fila de Produção"). Grouping is by the item FK (DEC-5)
   * — item names are already case-insensitively unique via normalized_name, so
   * this matches the source's case-insensitive name grouping.
   */
  demandsGroupedQuery(tenantId: string, pageSize: number, offset: number) {
    return sql`
      SELECT d.item_id::text     AS item_id,
             i.name              AS item_name,
             SUM(d.quantity)::int AS total_quantity,
             COUNT(*)::int       AS demand_count,
             MIN(d.created_at)   AS oldest_created_at,
             COALESCE((
               SELECT SUM(CASE WHEN m.type IN ('ENTRADA','AJUSTE','TRANSFERENCIA_IN')
                               THEN m.quantity ELSE -m.quantity END)
               FROM inv_stock_movements m
               WHERE m.tenant_id = ${tenantId}
                 AND m.item_id = d.item_id
                 AND m.location = 'ALMOXARIFADO'
             ), 0)::text AS almoxarifado_balance
      FROM inv_production_demands d
      JOIN inv_items i ON i.id = d.item_id
      WHERE d.tenant_id = ${tenantId} AND d.status = 'PENDENTE'
      GROUP BY d.item_id, i.name
      ORDER BY lower(i.name), d.item_id
      LIMIT ${pageSize} OFFSET ${offset}
    `;
  }

  async listPendingDemandsGrouped(
    tenantId: string,
    page: number,
    pageSize: number,
    client: ProductionDbClient = db,
  ): Promise<{ rows: DemandGroupRow[]; total: number }> {
    const result = await client.execute(this.demandsGroupedQuery(tenantId, pageSize, (page - 1) * pageSize));
    const raw = result as unknown as Array<Record<string, unknown>>;
    const rows = raw.map((r) => ({
      itemId: String(r.item_id),
      itemName: String(r.item_name),
      totalQuantity: Number(r.total_quantity),
      demandCount: Number(r.demand_count),
      oldestCreatedAt: r.oldest_created_at ? new Date(r.oldest_created_at as string) : null,
      almoxarifadoBalance: String(r.almoxarifado_balance),
    }));

    const countResult = await client.execute(sql`
      SELECT COUNT(DISTINCT d.item_id)::int AS total
      FROM inv_production_demands d
      JOIN inv_items i ON i.id = d.item_id
      WHERE d.tenant_id = ${tenantId} AND d.status = 'PENDENTE'
    `);
    const countRows = countResult as unknown as Array<{ total: number }>;
    return { rows, total: Number(countRows[0]?.total ?? 0) };
  }

  /**
   * FIFO queue for one product: PENDENTE demands, oldest first, locked for the
   * release transaction so two concurrent releases cannot double-consume.
   */
  lockPendingDemandsQuery(tenantId: string, itemId: string, client: ProductionDbClient = db) {
    return client
      .select()
      .from(invProductionDemands)
      .where(
        and(
          eq(invProductionDemands.tenantId, tenantId),
          eq(invProductionDemands.itemId, itemId),
          eq(invProductionDemands.status, 'PENDENTE'),
        ),
      )
      .orderBy(asc(invProductionDemands.createdAt), asc(invProductionDemands.id))
      .for('update');
  }

  async lockPendingDemandsForItem(
    tenantId: string,
    itemId: string,
    client: ProductionDbClient = db,
  ): Promise<InvProductionDemandRow[]> {
    return this.lockPendingDemandsQuery(tenantId, itemId, client);
  }

  async concludeDemand(tenantId: string, id: string, client: ProductionDbClient = db): Promise<void> {
    await client
      .update(invProductionDemands)
      .set({ status: 'CONCLUIDO' })
      .where(and(eq(invProductionDemands.tenantId, tenantId), eq(invProductionDemands.id, id)));
  }

  /** Partial FIFO consumption: reduce the pending quantity, keep PENDENTE. */
  async reduceDemandQuantity(
    tenantId: string,
    id: string,
    newQuantity: number,
    client: ProductionDbClient = db,
  ): Promise<void> {
    await client
      .update(invProductionDemands)
      .set({ quantity: newQuantity })
      .where(and(eq(invProductionDemands.tenantId, tenantId), eq(invProductionDemands.id, id)));
  }

  // ---------------------------------------------------------------------------
  // Assembly releases
  // ---------------------------------------------------------------------------

  async insertRelease(input: NewReleaseInput, client: ProductionDbClient = db): Promise<InvAssemblyReleaseRow> {
    const [row] = await client
      .insert(invAssemblyReleases)
      .values({
        tenantId: input.tenantId,
        photoFileId: input.photoFileId,
        responsibles: input.responsibles,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  async insertReleaseItems(
    inputs: NewReleaseItemInput[],
    client: ProductionDbClient = db,
  ): Promise<InvAssemblyReleaseItemRow[]> {
    if (inputs.length === 0) return [];
    return client.insert(invAssemblyReleaseItems).values(inputs).returning();
  }

  async listReleases(
    tenantId: string,
    page: number,
    pageSize: number,
    client: ProductionDbClient = db,
  ): Promise<{ rows: InvAssemblyReleaseRow[]; total: number }> {
    const rows = await client
      .select()
      .from(invAssemblyReleases)
      .where(eq(invAssemblyReleases.tenantId, tenantId))
      .orderBy(desc(invAssemblyReleases.createdAt), desc(invAssemblyReleases.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invAssemblyReleases)
      .where(eq(invAssemblyReleases.tenantId, tenantId));
    return { rows, total: count?.total ?? 0 };
  }

  /** Items (joined with catalog names) for a set of releases. */
  async listReleaseItems(
    tenantId: string,
    releaseIds: string[],
    client: ProductionDbClient = db,
  ): Promise<Array<ReleaseItemWithName & { releaseId: string }>> {
    if (releaseIds.length === 0) return [];
    return client
      .select({
        id: invAssemblyReleaseItems.id,
        releaseId: invAssemblyReleaseItems.releaseId,
        itemId: invAssemblyReleaseItems.itemId,
        itemName: invItems.name,
        quantity: invAssemblyReleaseItems.quantity,
      })
      .from(invAssemblyReleaseItems)
      .innerJoin(invItems, eq(invItems.id, invAssemblyReleaseItems.itemId))
      .where(
        and(
          eq(invAssemblyReleaseItems.tenantId, tenantId),
          inArray(invAssemblyReleaseItems.releaseId, releaseIds),
        ),
      )
      .orderBy(asc(invItems.name));
  }

  async getReleaseById(
    tenantId: string,
    id: string,
    client: ProductionDbClient = db,
  ): Promise<{ release: InvAssemblyReleaseRow; items: ReleaseItemWithName[] } | null> {
    const [release] = await client
      .select()
      .from(invAssemblyReleases)
      .where(and(eq(invAssemblyReleases.tenantId, tenantId), eq(invAssemblyReleases.id, id)))
      .limit(1);
    if (!release) return null;
    const items = await this.listReleaseItems(tenantId, [release.id], client);
    return { release, items };
  }

  async updateReleaseItemQuantity(
    tenantId: string,
    releaseItemId: string,
    quantity: number,
    client: ProductionDbClient = db,
  ): Promise<void> {
    await client
      .update(invAssemblyReleaseItems)
      .set({ quantity })
      .where(
        and(eq(invAssemblyReleaseItems.tenantId, tenantId), eq(invAssemblyReleaseItems.id, releaseItemId)),
      );
  }

  /**
   * Hard delete. Schema cascades take items, issues and the release's
   * homologations (+ their units) with it — movements are intentionally NOT
   * reversed (source parity; see service doc).
   */
  async deleteRelease(tenantId: string, id: string, client: ProductionDbClient = db): Promise<boolean> {
    const rows = await client
      .delete(invAssemblyReleases)
      .where(and(eq(invAssemblyReleases.tenantId, tenantId), eq(invAssemblyReleases.id, id)))
      .returning({ id: invAssemblyReleases.id });
    return rows.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Homologation floor (read-only — M5 owns these tables)
  // ---------------------------------------------------------------------------

  /** Units already homologated for a release, per item — the correction floor. */
  async homologatedCountsByItem(
    tenantId: string,
    releaseId: string,
    client: ProductionDbClient = db,
  ): Promise<HomologatedCountRow[]> {
    const rows = await client
      .select({
        itemId: invHomologations.itemId,
        homologatedCount: sql<number>`count(${invHomologationUnits.id})::int`,
      })
      .from(invHomologations)
      .leftJoin(invHomologationUnits, eq(invHomologationUnits.homologationId, invHomologations.id))
      .where(and(eq(invHomologations.tenantId, tenantId), eq(invHomologations.releaseId, releaseId)))
      .groupBy(invHomologations.itemId);
    return rows.map((r) => ({ itemId: r.itemId, homologatedCount: Number(r.homologatedCount) }));
  }

  // ---------------------------------------------------------------------------
  // Issues
  // ---------------------------------------------------------------------------

  async insertIssue(input: NewIssueInput, client: ProductionDbClient = db): Promise<InvAssemblyReleaseIssueRow> {
    const [row] = await client
      .insert(invAssemblyReleaseIssues)
      .values({
        tenantId: input.tenantId,
        releaseId: input.releaseId,
        releaseItemId: input.releaseItemId ?? null,
        itemId: input.itemId ?? null,
        reportedQuantity: input.reportedQuantity ?? null,
        message: input.message ?? null,
        status: 'ABERTA',
        reportedBy: input.reportedBy ?? null,
      })
      .returning();
    return row;
  }

  async listIssues(
    tenantId: string,
    releaseId: string,
    page: number,
    pageSize: number,
    client: ProductionDbClient = db,
  ): Promise<{ rows: InvAssemblyReleaseIssueRow[]; total: number }> {
    const where = and(
      eq(invAssemblyReleaseIssues.tenantId, tenantId),
      eq(invAssemblyReleaseIssues.releaseId, releaseId),
    );
    const rows = await client
      .select()
      .from(invAssemblyReleaseIssues)
      .where(where)
      .orderBy(desc(invAssemblyReleaseIssues.createdAt), desc(invAssemblyReleaseIssues.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invAssemblyReleaseIssues)
      .where(where);
    return { rows, total: count?.total ?? 0 };
  }

  async getIssueById(
    tenantId: string,
    id: string,
    client: ProductionDbClient = db,
  ): Promise<InvAssemblyReleaseIssueRow | null> {
    const [row] = await client
      .select()
      .from(invAssemblyReleaseIssues)
      .where(and(eq(invAssemblyReleaseIssues.tenantId, tenantId), eq(invAssemblyReleaseIssues.id, id)))
      .limit(1);
    return row ?? null;
  }

  async resolveIssue(
    tenantId: string,
    id: string,
    resolvedBy: string | null,
    resolutionNote: string | null,
    client: ProductionDbClient = db,
  ): Promise<InvAssemblyReleaseIssueRow | null> {
    const [row] = await client
      .update(invAssemblyReleaseIssues)
      .set({ status: 'RESOLVIDA', resolvedBy, resolvedAt: new Date(), resolutionNote })
      .where(
        and(
          eq(invAssemblyReleaseIssues.tenantId, tenantId),
          eq(invAssemblyReleaseIssues.id, id),
          eq(invAssemblyReleaseIssues.status, 'ABERTA'),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Resolve every open issue of a release (correction flow). */
  async resolveOpenIssues(
    tenantId: string,
    releaseId: string,
    resolvedBy: string | null,
    resolutionNote: string | null,
    client: ProductionDbClient = db,
  ): Promise<number> {
    const rows = await client
      .update(invAssemblyReleaseIssues)
      .set({ status: 'RESOLVIDA', resolvedBy, resolvedAt: new Date(), resolutionNote })
      .where(
        and(
          eq(invAssemblyReleaseIssues.tenantId, tenantId),
          eq(invAssemblyReleaseIssues.releaseId, releaseId),
          eq(invAssemblyReleaseIssues.status, 'ABERTA'),
        ),
      )
      .returning({ id: invAssemblyReleaseIssues.id });
    return rows.length;
  }

  // ---------------------------------------------------------------------------
  // BOM & capacity reads
  // ---------------------------------------------------------------------------

  /** BOM rows for a set of products, with the component's loss percent. */
  async getBomsForProducts(
    tenantId: string,
    productItemIds: string[],
    client: ProductionDbClient = db,
  ): Promise<BomExplosionRow[]> {
    if (productItemIds.length === 0) return [];
    return client
      .select({
        productItemId: invBoms.productItemId,
        componentItemId: invBoms.componentItemId,
        componentName: invItems.name,
        quantity: invBoms.quantity,
        lossPercent: invItems.lossPercent,
      })
      .from(invBoms)
      .innerJoin(invItems, eq(invItems.id, invBoms.componentItemId))
      .where(and(eq(invBoms.tenantId, tenantId), inArray(invBoms.productItemId, productItemIds)))
      .orderBy(asc(invItems.name));
  }

  /** Active manufactured PRODUCTs (the capacity page population). */
  async listManufacturedProducts(
    tenantId: string,
    page: number,
    pageSize: number,
    client: ProductionDbClient = db,
  ): Promise<{ rows: Array<{ id: string; name: string }>; total: number }> {
    const where = and(
      eq(invItems.tenantId, tenantId),
      eq(invItems.domain, 'PRODUCT'),
      eq(invItems.isManufactured, true),
      eq(invItems.active, true),
    );
    const rows = await client
      .select({ id: invItems.id, name: invItems.name })
      .from(invItems)
      .where(where)
      .orderBy(asc(invItems.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invItems)
      .where(where);
    return { rows, total: count?.total ?? 0 };
  }

  /** Catalog rows by id (validation of release/simulator inputs). */
  async findItemsByIds(
    tenantId: string,
    ids: string[],
    client: ProductionDbClient = db,
  ): Promise<Array<typeof invItems.$inferSelect>> {
    if (ids.length === 0) return [];
    return client
      .select()
      .from(invItems)
      .where(and(eq(invItems.tenantId, tenantId), inArray(invItems.id, ids)));
  }

  /** Derived balances for a set of components at one location (no lock). */
  async componentBalances(
    tenantId: string,
    componentItemIds: string[],
    location: string,
    client: ProductionDbClient = db,
  ): Promise<ComponentBalanceRow[]> {
    if (componentItemIds.length === 0) return [];
    return client
      .select({
        itemId: invStockMovements.itemId,
        balance: sql<string>`coalesce(sum(case when ${invStockMovements.type} in ('ENTRADA','AJUSTE','TRANSFERENCIA_IN') then ${invStockMovements.quantity} else -${invStockMovements.quantity} end), 0)::text`,
      })
      .from(invStockMovements)
      .where(
        and(
          eq(invStockMovements.tenantId, tenantId),
          inArray(invStockMovements.itemId, componentItemIds),
          eq(invStockMovements.location, location),
        ),
      )
      .groupBy(invStockMovements.itemId);
  }
}

export const inventoryProductionRepository = new InventoryProductionRepository();
