// =============================================================================
// RFC-0061 M2 — Stock ledger repository (data access only).
//
// Owns `inv_stock_movements` + `inv_movement_qrs` and the aggregate views over
// them. Balance is ALWAYS derived from the movements (DEC-2, never stored):
//   in  = ENTRADA + AJUSTE + TRANSFERENCIA_IN
//   out = SAIDA + TRANSFERENCIA_OUT
//
// Conventions (matched from consumptionGoalRepository / CentralReplacement-
// Repository): shared `db` client, tenant-scoped reads, every mutating method
// accepts an optional executor so the service composes them inside ONE
// transaction; `withTransaction` exposes the boundary; row locking of the item
// (`SELECT … FOR UPDATE` on inv_items) serializes concurrent movements per
// item so the service's negative-stock guard is race-free (§M2).
//
// Query builders are public so SQL-shape tests can assert the generated SQL
// (PgDialect.sqlToQuery) without a database.
// =============================================================================

import { and, desc, eq, inArray, sql, SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const { invItems, invStockMovements, invMovementQrs } = schema;

// -----------------------------------------------------------------------------
// Transaction typing (same derivation as consumptionGoalRepository)
// -----------------------------------------------------------------------------

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
export type StockTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the root `db` client or an in-flight transaction. */
export type StockDbClient = typeof db | StockTx;

// -----------------------------------------------------------------------------
// Row & input types
// -----------------------------------------------------------------------------

export type InvItemRow = typeof invItems.$inferSelect;
export type InvStockMovementRow = typeof invStockMovements.$inferSelect;
export type InvMovementQrRow = typeof invMovementQrs.$inferSelect;

/** Movement insert payload (quantity as string — numeric(12,3) column). */
export interface NewMovementInput {
  tenantId: string;
  itemId: string;
  location: string;
  quantity: string;
  type: string;
  reason?: string | null;
  responsible?: string | null;
  photoFileId?: string | null;
  purchaseOrderId?: string | null;
  transferGroupId?: string | null;
  createdBy?: string | null;
}

export interface NewMovementQrInput {
  qrValue?: string;
  boxQr?: string;
  homologationUnitId?: string;
}

/** Aggregate totals for one (item, location). Numerics come back as strings. */
export interface BalanceTotals {
  balance: string;
  totalIn: string;
  totalOut: string;
  lastMovementAt: Date | null;
}

/** One row of the grouped balances listing (joined with the catalog). */
export interface BalanceListRow extends BalanceTotals {
  itemId: string;
  itemName: string;
  domain: string;
  location: string;
}

export interface BalanceListFilters {
  location?: string;
  domain?: string;
}

/** Ledger-vs-QR consistency row (W1) for manufactured products. */
export interface ConsistencyRow {
  itemId: string;
  location: string;
  ledgerBalance: string;
  activeQrCount: number;
}

const IN_TYPES = ['ENTRADA', 'AJUSTE', 'TRANSFERENCIA_IN'] as const;
const OUT_TYPES = ['SAIDA', 'TRANSFERENCIA_OUT'] as const;

// Signed-quantity SQL fragments shared by the aggregate builders.
const totalInExpr = sql<string>`coalesce(sum(${invStockMovements.quantity}) filter (where ${invStockMovements.type} in ('ENTRADA','AJUSTE','TRANSFERENCIA_IN')), 0)::text`;
const totalOutExpr = sql<string>`coalesce(sum(${invStockMovements.quantity}) filter (where ${invStockMovements.type} in ('SAIDA','TRANSFERENCIA_OUT')), 0)::text`;
const balanceExpr = sql<string>`coalesce(sum(case when ${invStockMovements.type} in ('ENTRADA','AJUSTE','TRANSFERENCIA_IN') then ${invStockMovements.quantity} else -${invStockMovements.quantity} end), 0)::text`;
const lastMovementExpr = sql<Date | null>`max(${invStockMovements.createdAt})`;

export class InventoryStockRepository {
  // ---------------------------------------------------------------------------
  // Transaction boundary
  // ---------------------------------------------------------------------------

  /** Runs `fn` inside one DB transaction (movement + QR links + guards). */
  async withTransaction<T>(fn: (tx: StockTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  // ---------------------------------------------------------------------------
  // Query builders (public for SQL-shape tests)
  // ---------------------------------------------------------------------------

  /**
   * Lock the item row for the whole transaction (`SELECT … FOR UPDATE`).
   * Serializes concurrent movements on the same item so the derived-balance
   * guard cannot race (§M2 — the source's trigger summed without a lock).
   */
  lockItemQuery(tenantId: string, itemId: string, client: StockDbClient = db) {
    return client
      .select()
      .from(invItems)
      .where(and(eq(invItems.tenantId, tenantId), eq(invItems.id, itemId)))
      .limit(1)
      .for('update');
  }

  /** Aggregate totals for one (item, location). */
  balanceQuery(tenantId: string, itemId: string, location: string, client: StockDbClient = db) {
    return client
      .select({
        balance: balanceExpr,
        totalIn: totalInExpr,
        totalOut: totalOutExpr,
        lastMovementAt: lastMovementExpr,
      })
      .from(invStockMovements)
      .where(
        and(
          eq(invStockMovements.tenantId, tenantId),
          eq(invStockMovements.itemId, itemId),
          eq(invStockMovements.location, location),
        ),
      );
  }

  /** Grouped balances per (item, location), joined with the catalog. */
  listBalancesQuery(tenantId: string, filters: BalanceListFilters = {}, client: StockDbClient = db) {
    const conditions: (SQL | undefined)[] = [eq(invStockMovements.tenantId, tenantId)];
    if (filters.location) conditions.push(eq(invStockMovements.location, filters.location));
    if (filters.domain) conditions.push(eq(invItems.domain, filters.domain));

    return client
      .select({
        itemId: invStockMovements.itemId,
        itemName: invItems.name,
        domain: invItems.domain,
        location: invStockMovements.location,
        balance: balanceExpr,
        totalIn: totalInExpr,
        totalOut: totalOutExpr,
        lastMovementAt: lastMovementExpr,
      })
      .from(invStockMovements)
      .innerJoin(invItems, eq(invItems.id, invStockMovements.itemId))
      .where(and(...conditions))
      .groupBy(invStockMovements.itemId, invItems.name, invItems.domain, invStockMovements.location)
      .orderBy(invItems.name, invStockMovements.location);
  }

  /** Paginated movement history (newest first). */
  listMovementsQuery(tenantId: string, page: number, pageSize: number, client: StockDbClient = db) {
    return client
      .select()
      .from(invStockMovements)
      .where(eq(invStockMovements.tenantId, tenantId))
      .orderBy(desc(invStockMovements.createdAt), desc(invStockMovements.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  }

  /**
   * W1 consistency report (manufactured PRODUCTs): ledger balance vs count of
   * ACTIVE QRs per item×location. A QR is active at the location of its LATEST
   * ledger event when that event is not an exit (anti-double-exit ledger).
   * v1 approximation: unit QRs only (`qr_value`); box QRs are an M5/M6 concern.
   */
  consistencyQuery(tenantId: string): SQL {
    return sql`
      WITH ledger AS (
        SELECT m.item_id, m.location,
               COALESCE(SUM(CASE WHEN m.type IN ('ENTRADA','AJUSTE','TRANSFERENCIA_IN')
                                 THEN m.quantity ELSE -m.quantity END), 0) AS ledger_balance
        FROM inv_stock_movements m
        JOIN inv_items i ON i.id = m.item_id
        WHERE m.tenant_id = ${tenantId} AND i.is_manufactured
        GROUP BY m.item_id, m.location
      ), latest_qr AS (
        SELECT DISTINCT ON (mq.qr_value) mq.qr_value, m.item_id, m.location, m.type
        FROM inv_movement_qrs mq
        JOIN inv_stock_movements m ON m.id = mq.movement_id
        JOIN inv_items i ON i.id = m.item_id
        WHERE mq.tenant_id = ${tenantId} AND mq.qr_value IS NOT NULL AND i.is_manufactured
        ORDER BY mq.qr_value, m.created_at DESC, m.id DESC
      ), active_qrs AS (
        SELECT item_id, location, COUNT(*)::int AS active_qr_count
        FROM latest_qr
        WHERE type NOT IN ('SAIDA','TRANSFERENCIA_OUT')
        GROUP BY item_id, location
      )
      SELECT COALESCE(l.item_id, a.item_id)::text        AS item_id,
             COALESCE(l.location, a.location)            AS location,
             COALESCE(l.ledger_balance, 0)::text         AS ledger_balance,
             COALESCE(a.active_qr_count, 0)              AS active_qr_count
      FROM ledger l
      FULL OUTER JOIN active_qrs a
        ON a.item_id = l.item_id AND a.location = l.location
      ORDER BY 1, 2
    `;
  }

  /** Scope-delete of the ledger (POST /stock/reset). QR links CASCADE. */
  deleteMovementsQuery(tenantId: string, location?: string, client: StockDbClient = db) {
    const conditions: (SQL | undefined)[] = [eq(invStockMovements.tenantId, tenantId)];
    if (location) conditions.push(eq(invStockMovements.location, location));
    return client
      .delete(invStockMovements)
      .where(and(...conditions))
      .returning({ id: invStockMovements.id });
  }

  // ---------------------------------------------------------------------------
  // Executors
  // ---------------------------------------------------------------------------

  /** Lock + load the item row (null when absent in this tenant). */
  async lockItem(tenantId: string, itemId: string, client: StockDbClient = db): Promise<InvItemRow | null> {
    const [row] = await this.lockItemQuery(tenantId, itemId, client);
    return row ?? null;
  }

  async getBalance(
    tenantId: string,
    itemId: string,
    location: string,
    client: StockDbClient = db,
  ): Promise<BalanceTotals> {
    const [row] = await this.balanceQuery(tenantId, itemId, location, client);
    return row ?? { balance: '0', totalIn: '0', totalOut: '0', lastMovementAt: null };
  }

  async listBalances(
    tenantId: string,
    filters: BalanceListFilters = {},
    client: StockDbClient = db,
  ): Promise<BalanceListRow[]> {
    return this.listBalancesQuery(tenantId, filters, client);
  }

  async listMovements(
    tenantId: string,
    page: number,
    pageSize: number,
    client: StockDbClient = db,
  ): Promise<{ rows: InvStockMovementRow[]; total: number }> {
    const rows = await this.listMovementsQuery(tenantId, page, pageSize, client);
    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invStockMovements)
      .where(eq(invStockMovements.tenantId, tenantId));
    return { rows, total: count?.total ?? 0 };
  }

  async getMovementById(
    tenantId: string,
    id: string,
    client: StockDbClient = db,
  ): Promise<{ movement: InvStockMovementRow; qrs: InvMovementQrRow[] } | null> {
    const [movement] = await client
      .select()
      .from(invStockMovements)
      .where(and(eq(invStockMovements.tenantId, tenantId), eq(invStockMovements.id, id)))
      .limit(1);
    if (!movement) return null;
    const qrs = await client
      .select()
      .from(invMovementQrs)
      .where(eq(invMovementQrs.movementId, movement.id));
    return { movement, qrs };
  }

  async insertMovement(input: NewMovementInput, client: StockDbClient = db): Promise<InvStockMovementRow> {
    const [row] = await client
      .insert(invStockMovements)
      .values({
        tenantId: input.tenantId,
        itemId: input.itemId,
        location: input.location,
        quantity: input.quantity,
        type: input.type,
        reason: input.reason ?? null,
        responsible: input.responsible ?? null,
        photoFileId: input.photoFileId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  }

  async insertMovementQrs(
    tenantId: string,
    movementId: string,
    qrs: NewMovementQrInput[],
    client: StockDbClient = db,
  ): Promise<InvMovementQrRow[]> {
    if (qrs.length === 0) return [];
    return client
      .insert(invMovementQrs)
      .values(
        qrs.map((q) => ({
          tenantId,
          movementId,
          qrValue: q.qrValue ?? null,
          boxQr: q.boxQr ?? null,
          homologationUnitId: q.homologationUnitId ?? null,
        })),
      )
      .returning();
  }

  /**
   * Latest ledger event type per QR value (anti-double-exit). Rows come back
   * newest-first per QR; the first occurrence wins. Called under the item lock
   * so two concurrent exits of the same QR serialize on the item row.
   */
  async latestQrEventTypes(
    tenantId: string,
    qrValues: string[],
    client: StockDbClient = db,
  ): Promise<Map<string, string>> {
    if (qrValues.length === 0) return new Map();
    const rows = await client
      .select({ qrValue: invMovementQrs.qrValue, type: invStockMovements.type })
      .from(invMovementQrs)
      .innerJoin(invStockMovements, eq(invStockMovements.id, invMovementQrs.movementId))
      .where(and(eq(invMovementQrs.tenantId, tenantId), inArray(invMovementQrs.qrValue, qrValues)))
      .orderBy(invMovementQrs.qrValue, desc(invStockMovements.createdAt), desc(invStockMovements.id));

    const latest = new Map<string, string>();
    for (const row of rows) {
      if (row.qrValue && !latest.has(row.qrValue)) latest.set(row.qrValue, row.type);
    }
    return latest;
  }

  async consistencyReport(tenantId: string, client: StockDbClient = db): Promise<ConsistencyRow[]> {
    const result = await client.execute(this.consistencyQuery(tenantId));
    const rows = result as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      itemId: String(r.item_id),
      location: String(r.location),
      ledgerBalance: String(r.ledger_balance),
      activeQrCount: Number(r.active_qr_count),
    }));
  }

  async deleteMovements(tenantId: string, location?: string, client: StockDbClient = db): Promise<number> {
    const rows = await this.deleteMovementsQuery(tenantId, location, client);
    return rows.length;
  }
}

export const inventoryStockRepository = new InventoryStockRepository();

/** Movement direction sets, exported for the service/tests. */
export const STOCK_IN_TYPES = IN_TYPES;
export const STOCK_OUT_TYPES = OUT_TYPES;
