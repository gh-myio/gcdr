// =============================================================================
// RFC-0061 M8 — External sync repository (data access only).
//
// Owns `inv_external_states` (platform mirror), `inv_external_sync_state`
// (per-tenant single-flight lease + run report) and `inv_external_push_outbox`
// (DEC-6 transactional outbox), plus the M8-specific batch reads over sibling
// tables (unit products by label, projects by name, technician dispatches by
// QR, open damaged reports, in-transit orders). All writes accept an optional
// executor so the sync/outbox services compose them inside one transaction
// (same seam as InventoryStockRepository).
//
// Outbox drain (DEC-6/W3): `claimOutboxBatchQuery` is the raw claim —
// `FOR UPDATE SKIP LOCKED` (deploy-safe under side-by-side instances) with
// per-QR FIFO: a row is eligible only if NO older live row shares any of its
// `qr_codes` (array overlap `&&`). "Live" = status PENDING/FAILED with
// attempts < max; a dead-lettered row (attempts exhausted) neither drains nor
// blocks — the pull-sync reconciliation is the safety net for its QRs, and a
// younger push for the same QR carries newer state anyway.
// =============================================================================

import { and, asc, desc, eq, ilike, inArray, notInArray, or, sql, SQL } from 'drizzle-orm';
import { db, schema } from '../../infrastructure/database/drizzle/db';

const {
  invExternalStates,
  invExternalSyncState,
  invExternalPushOutbox,
  invUnitProducts,
  invProjects,
  invStockMovements,
  invMovementQrs,
  invDamagedItems,
  invExpeditionOrders,
} = schema;

// -----------------------------------------------------------------------------
// Transaction typing (same derivation as InventoryStockRepository)
// -----------------------------------------------------------------------------

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
export type ExternalTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the root `db` client or an in-flight transaction. */
export type ExternalDbClient = typeof db | ExternalTx;

// -----------------------------------------------------------------------------
// Row & input types
// -----------------------------------------------------------------------------

export type InvExternalStateRow = typeof invExternalStates.$inferSelect;
export type InvExternalSyncStateRow = typeof invExternalSyncState.$inferSelect;
export type InvExternalPushOutboxRow = typeof invExternalPushOutbox.$inferSelect;
export type InvUnitProductRow = typeof invUnitProducts.$inferSelect;
export type InvProjectRow = typeof invProjects.$inferSelect;
export type InvDamagedItemRow = typeof invDamagedItems.$inferSelect;
export type InvExpeditionOrderRow = typeof invExpeditionOrders.$inferSelect;

export interface ExternalStateUpsertInput {
  tenantId: string;
  code: string;
  productType?: string | null;
  location?: string | null;
  status?: string | null;
  technician?: string | null;
  clientName?: string | null;
  qrValue?: string | null;
  itemId?: string | null;
  homologationUnitId?: string | null;
  /** Computed by the service: kept when nothing changed, bumped when it did. */
  lastChangeAt?: Date | null;
  payload?: unknown;
}

export interface ExternalStateListFilters {
  page: number;
  pageSize: number;
  location?: string;
  status?: string;
  /** Substring match on code (ILIKE). */
  q?: string;
}

export interface SyncRunReportInput {
  status: 'OK' | 'PARCIAL' | 'ERRO';
  /** JSON run report (shadow corrections land here too — see the service). */
  message: string;
  totalItems: number;
}

export interface OutboxCounters {
  pending: number;
  retryable: number;
  dead: number;
  done: number;
}

/** One technician dispatch linked to a QR (reconciliation input). */
export interface DispatchByQrRow {
  movementId: string;
  itemId: string;
  technician: string;
  quantity: string;
  movedQuantity: number;
  qrValue: string;
  createdAt: Date;
}

/** Default ceiling before a row is dead-lettered (INV_OUTBOX_MAX_ATTEMPTS). */
export const OUTBOX_MAX_ATTEMPTS = 6;

export class InventoryExternalRepository {
  // ---------------------------------------------------------------------------
  // Transaction boundary
  // ---------------------------------------------------------------------------

  async withTransaction<T>(fn: (tx: ExternalTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  // ---------------------------------------------------------------------------
  // Mirror — inv_external_states
  // ---------------------------------------------------------------------------

  async listStates(
    tenantId: string,
    filters: ExternalStateListFilters,
    client: ExternalDbClient = db,
  ): Promise<{ rows: InvExternalStateRow[]; total: number }> {
    const conditions: (SQL | undefined)[] = [eq(invExternalStates.tenantId, tenantId)];
    if (filters.location) conditions.push(eq(invExternalStates.location, filters.location));
    if (filters.status) conditions.push(eq(invExternalStates.status, filters.status));
    if (filters.q) conditions.push(ilike(invExternalStates.code, `%${filters.q}%`));
    const where = and(...conditions);

    const rows = await client
      .select()
      .from(invExternalStates)
      .where(where)
      .orderBy(asc(invExternalStates.code))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
    const [count] = await client
      .select({ total: sql<number>`count(*)::int` })
      .from(invExternalStates)
      .where(where);
    return { rows, total: count?.total ?? 0 };
  }

  /** Full mirror for one tenant (diff base for the pull worker; ≤ item cap). */
  async allStates(tenantId: string, client: ExternalDbClient = db): Promise<InvExternalStateRow[]> {
    return client.select().from(invExternalStates).where(eq(invExternalStates.tenantId, tenantId));
  }

  /** Upsert one mirror row (onConflict tenant+code; raw payload kept). */
  async upsertState(input: ExternalStateUpsertInput, client: ExternalDbClient = db): Promise<InvExternalStateRow> {
    const values = {
      tenantId: input.tenantId,
      code: input.code,
      productType: input.productType ?? null,
      location: input.location ?? null,
      status: input.status ?? null,
      technician: input.technician ?? null,
      clientName: input.clientName ?? null,
      qrValue: input.qrValue ?? null,
      itemId: input.itemId ?? null,
      homologationUnitId: input.homologationUnitId ?? null,
      lastChangeAt: input.lastChangeAt ?? null,
      payload: input.payload ?? null,
      updatedAt: new Date(),
    };
    const [row] = await client
      .insert(invExternalStates)
      .values(values)
      .onConflictDoUpdate({
        target: [invExternalStates.tenantId, invExternalStates.code],
        set: {
          productType: values.productType,
          location: values.location,
          status: values.status,
          technician: values.technician,
          clientName: values.clientName,
          qrValue: values.qrValue,
          itemId: values.itemId,
          homologationUnitId: values.homologationUnitId,
          lastChangeAt: values.lastChangeAt,
          payload: values.payload,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    return row;
  }

  /** Golden rule cleanup: drop mirror rows whose code is no longer eligible. */
  async deleteStatesNotIn(tenantId: string, keepCodes: string[], client: ExternalDbClient = db): Promise<number> {
    const conditions: (SQL | undefined)[] = [eq(invExternalStates.tenantId, tenantId)];
    if (keepCodes.length > 0) conditions.push(notInArray(invExternalStates.code, keepCodes));
    const rows = await client
      .delete(invExternalStates)
      .where(and(...conditions))
      .returning({ id: invExternalStates.id });
    return rows.length;
  }

  // ---------------------------------------------------------------------------
  // Sync state — inv_external_sync_state (single-flight lease, §M8)
  // ---------------------------------------------------------------------------

  /**
   * Atomic lease claim: one UPSERT that only takes the lease when it is free
   * or expired (`setWhere`). Returns the row when claimed, null when another
   * runner holds it — the persisted single-flight the RFC requires.
   */
  async claimLease(
    tenantId: string,
    leaseMs: number,
    client: ExternalDbClient = db,
  ): Promise<InvExternalSyncStateRow | null> {
    const leaseUntil = new Date(Date.now() + leaseMs);
    const [row] = await client
      .insert(invExternalSyncState)
      .values({ tenantId, leaseUntil })
      .onConflictDoUpdate({
        target: invExternalSyncState.tenantId,
        set: { leaseUntil },
        setWhere: sql`${invExternalSyncState.leaseUntil} IS NULL OR ${invExternalSyncState.leaseUntil} < now()`,
      })
      .returning();
    return row ?? null;
  }

  /** Release the lease and persist the run report (`ok|parcial|erro`). */
  async releaseLease(
    tenantId: string,
    report: SyncRunReportInput,
    client: ExternalDbClient = db,
  ): Promise<void> {
    await client
      .update(invExternalSyncState)
      .set({
        leaseUntil: null,
        lastRunAt: new Date(),
        lastStatus: report.status,
        lastMessage: report.message,
        totalItems: report.totalItems,
      })
      .where(eq(invExternalSyncState.tenantId, tenantId));
  }

  async getSyncState(tenantId: string, client: ExternalDbClient = db): Promise<InvExternalSyncStateRow | null> {
    const [row] = await client
      .select()
      .from(invExternalSyncState)
      .where(eq(invExternalSyncState.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  }

  // ---------------------------------------------------------------------------
  // Outbox — inv_external_push_outbox (DEC-6 drain)
  // ---------------------------------------------------------------------------

  /**
   * Raw claim query (public for SQL-shape tests): oldest-first batch of live
   * rows due now, skipping any row that shares a QR with an OLDER live row
   * (per-QR FIFO — W3), locked with FOR UPDATE SKIP LOCKED so overlapping
   * instances never double-dispatch. Must run inside the drain transaction.
   */
  claimOutboxBatchQuery(limit: number, maxAttempts: number = OUTBOX_MAX_ATTEMPTS): SQL {
    return sql`
      SELECT o.*
      FROM inv_external_push_outbox o
      WHERE o.status IN ('PENDING','FAILED')
        AND o.attempts < ${maxAttempts}
        AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= now())
        AND NOT EXISTS (
          SELECT 1 FROM inv_external_push_outbox older
          WHERE older.tenant_id = o.tenant_id
            AND older.status IN ('PENDING','FAILED')
            AND older.attempts < ${maxAttempts}
            AND older.qr_codes && o.qr_codes
            AND (older.created_at < o.created_at
                 OR (older.created_at = o.created_at AND older.id < o.id))
        )
      ORDER BY o.created_at ASC, o.id ASC
      LIMIT ${limit}
      FOR UPDATE OF o SKIP LOCKED
    `;
  }

  /** Claim a drain batch (see claimOutboxBatchQuery). Call inside a tx. */
  async claimOutboxBatch(
    limit: number,
    tx: ExternalTx,
    maxAttempts: number = OUTBOX_MAX_ATTEMPTS,
  ): Promise<InvExternalPushOutboxRow[]> {
    const result = await tx.execute(this.claimOutboxBatchQuery(limit, maxAttempts));
    const rows = result as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      tenantId: String(r.tenant_id),
      qrCodes: (r.qr_codes ?? []) as string[],
      location: (r.location ?? null) as string | null,
      status: String(r.status),
      technician: (r.technician ?? null) as string | null,
      clientName: (r.client_name ?? null) as string | null,
      attempts: Number(r.attempts ?? 0),
      nextAttemptAt: (r.next_attempt_at ?? null) as Date | null,
      lastError: (r.last_error ?? null) as string | null,
      dispatchedAt: (r.dispatched_at ?? null) as Date | null,
      createdAt: r.created_at as Date,
    }));
  }

  async markOutboxDispatched(ids: string[], client: ExternalDbClient = db): Promise<void> {
    if (ids.length === 0) return;
    await client
      .update(invExternalPushOutbox)
      .set({ status: 'DONE', dispatchedAt: new Date(), lastError: null })
      .where(inArray(invExternalPushOutbox.id, ids));
  }

  /**
   * Record one failed dispatch: attempts+1 and exponential backoff. When the
   * attempts ceiling is reached the row keeps status FAILED with
   * next_attempt_at NULL — dead-lettered: it stops draining AND stops blocking
   * (see the header note), keeping only last_error for operators.
   */
  async markOutboxFailed(
    id: string,
    attempts: number,
    nextAttemptAt: Date | null,
    lastError: string,
    client: ExternalDbClient = db,
  ): Promise<void> {
    await client
      .update(invExternalPushOutbox)
      .set({ status: 'FAILED', attempts, nextAttemptAt, lastError: lastError.slice(0, 2000) })
      .where(eq(invExternalPushOutbox.id, id));
  }

  async outboxCounters(
    tenantId: string,
    maxAttempts: number = OUTBOX_MAX_ATTEMPTS,
    client: ExternalDbClient = db,
  ): Promise<OutboxCounters> {
    const [row] = await client
      .select({
        pending: sql<number>`count(*) FILTER (WHERE ${invExternalPushOutbox.status} = 'PENDING')::int`,
        retryable: sql<number>`count(*) FILTER (WHERE ${invExternalPushOutbox.status} = 'FAILED' AND ${invExternalPushOutbox.attempts} < ${maxAttempts})::int`,
        dead: sql<number>`count(*) FILTER (WHERE ${invExternalPushOutbox.status} = 'FAILED' AND ${invExternalPushOutbox.attempts} >= ${maxAttempts})::int`,
        done: sql<number>`count(*) FILTER (WHERE ${invExternalPushOutbox.status} = 'DONE')::int`,
      })
      .from(invExternalPushOutbox)
      .where(eq(invExternalPushOutbox.tenantId, tenantId));
    return row ?? { pending: 0, retryable: 0, dead: 0, done: 0 };
  }

  // ---------------------------------------------------------------------------
  // Batch reads over sibling tables (M8-only; writes stay in the owner repos)
  // ---------------------------------------------------------------------------

  /** Unit products holding any of the labels (QR spellings — bare or URL). */
  async unitProductsByLabels(
    tenantId: string,
    labels: string[],
    client: ExternalDbClient = db,
  ): Promise<InvUnitProductRow[]> {
    if (labels.length === 0) return [];
    return client
      .select()
      .from(invUnitProducts)
      .where(and(eq(invUnitProducts.tenantId, tenantId), inArray(invUnitProducts.label, labels)));
  }

  /** Projects matched case-insensitively by name ("Projeto = Cliente" rule). */
  async projectsByNamesInsensitive(
    tenantId: string,
    names: string[],
    client: ExternalDbClient = db,
  ): Promise<InvProjectRow[]> {
    if (names.length === 0) return [];
    const lowered = names.map((n) => n.toLowerCase());
    return client
      .select()
      .from(invProjects)
      .where(
        and(
          eq(invProjects.tenantId, tenantId),
          inArray(sql`lower(${invProjects.name})`, lowered),
        ),
      );
  }

  /**
   * Technician dispatches (SAIDA with a responsible) linked to any of the QR
   * spellings, with the Σ already consumed — newest first so the service can
   * take the latest dispatch per QR ("zera a lista do técnico" input).
   */
  async dispatchesByQrValues(
    tenantId: string,
    qrValues: string[],
    client: ExternalDbClient = db,
  ): Promise<DispatchByQrRow[]> {
    if (qrValues.length === 0) return [];
    const movedQuantityExpr = sql<number>`coalesce((
      select sum(tm.quantity)::int
      from inv_technician_moves tm
      where tm.movement_id = ${invStockMovements.id}
    ), 0)`;
    const rows = await client
      .select({
        movementId: invStockMovements.id,
        itemId: invStockMovements.itemId,
        technician: invStockMovements.responsible,
        quantity: invStockMovements.quantity,
        movedQuantity: movedQuantityExpr,
        qrValue: invMovementQrs.qrValue,
        createdAt: invStockMovements.createdAt,
      })
      .from(invMovementQrs)
      .innerJoin(invStockMovements, eq(invStockMovements.id, invMovementQrs.movementId))
      .where(
        and(
          eq(invMovementQrs.tenantId, tenantId),
          inArray(invMovementQrs.qrValue, qrValues),
          eq(invStockMovements.type, 'SAIDA'),
          sql`${invStockMovements.responsible} IS NOT NULL AND btrim(${invStockMovements.responsible}) <> ''`,
        ),
      )
      .orderBy(desc(invStockMovements.createdAt), desc(invStockMovements.id));
    return rows
      .filter((r) => r.qrValue !== null)
      .map((r) => ({ ...r, technician: r.technician as string, qrValue: r.qrValue as string }));
  }

  /** Open damage reports (status AVARIADO) — the service matches codes in
   *  source_detail to enforce "one open row per code". */
  async listOpenDamaged(tenantId: string, client: ExternalDbClient = db): Promise<InvDamagedItemRow[]> {
    return client
      .select()
      .from(invDamagedItems)
      .where(and(eq(invDamagedItems.tenantId, tenantId), eq(invDamagedItems.status, 'AVARIADO')));
  }

  /** Expedition orders currently EM_TRANSITO (auto-transition candidates). */
  async ordersInTransit(tenantId: string, client: ExternalDbClient = db): Promise<InvExpeditionOrderRow[]> {
    return client
      .select()
      .from(invExpeditionOrders)
      .where(and(eq(invExpeditionOrders.tenantId, tenantId), eq(invExpeditionOrders.status, 'EM_TRANSITO')));
  }

  /** Mirror rows matching any spelling (code or qr_value) — transit checks. */
  async statesByCodesOrQrs(
    tenantId: string,
    values: string[],
    client: ExternalDbClient = db,
  ): Promise<InvExternalStateRow[]> {
    if (values.length === 0) return [];
    return client
      .select()
      .from(invExternalStates)
      .where(
        and(
          eq(invExternalStates.tenantId, tenantId),
          or(inArray(invExternalStates.code, values), inArray(invExternalStates.qrValue, values)),
        ),
      );
  }
}

export const inventoryExternalRepository = new InventoryExternalRepository();
