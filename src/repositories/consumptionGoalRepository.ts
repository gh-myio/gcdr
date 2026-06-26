// =============================================================================
// RFC-0046 — Customer Consumption Goals: repository (data access)
//
// Owns the four goals tables:
//   - consumptionGoals        (parent — one per tenant+customer+domain+year)
//   - consumptionGoalHours    (canonical hourly grain)
//   - consumptionGoalDomains  (fixed aggregation config per tenant+domain)
//   - consumptionGoalHistory  (append-only audit of operator-level edits)
//
// Conventions (matched from CustomerRepository / DeviceSyncJobRepository /
// WorkOrderLifecycleRepository): the shared `db` client, tenant-scoped reads,
// Drizzle `eq/and`, `db.transaction(async (tx) => ...)` for atomicity.
//
// Ratified storage rules this repo encodes (no business logic — that lives in
// the service):
//   - hour is the only stored grain (DEC-1);
//   - `version` lives on the parent and bumps per change (DEC-4) — the bump is a
//     guarded `UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`
//     (optimistic concurrency); a 0-row result is a version conflict;
//   - the hour upsert + version bump + history append run in ONE transaction —
//     every mutating method accepts an optional `tx` so the service can compose
//     them; `withTransaction` exposes the transaction boundary.
//   - `aggregation_method` is fixed per domain, read from consumption_goal_domains
//     (seeded on demand if missing).
// =============================================================================

import { and, eq, desc, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import type { GoalAggregationMethod, GoalDomain, GoalSourceLevel } from '../dto/request/GoalsDTO';

const { consumptionGoals, consumptionGoalHours, consumptionGoalDomains, consumptionGoalHistory } = schema;

// -----------------------------------------------------------------------------
// Transaction typing
//
// Drizzle does not export a stable transaction-client type alias, so we derive
// it from `db.transaction`'s callback parameter. Both `db` and a `tx` satisfy
// `GoalDbClient`, letting every method accept an optional executor.
// -----------------------------------------------------------------------------

/** The Drizzle transaction client passed to `db.transaction(async (tx) => …)`. */
export type GoalTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Either the root `db` client or an in-flight transaction. */
export type GoalDbClient = typeof db | GoalTx;

// -----------------------------------------------------------------------------
// Row & input types
// -----------------------------------------------------------------------------

export type ConsumptionGoalRow = typeof consumptionGoals.$inferSelect;
export type ConsumptionGoalHourRow = typeof consumptionGoalHours.$inferSelect;
export type ConsumptionGoalDomainRow = typeof consumptionGoalDomains.$inferSelect;
export type ConsumptionGoalHistoryRow = typeof consumptionGoalHistory.$inferSelect;

/** Identifies the parent goal tree. */
export interface GoalKey {
  tenantId: string;
  customerId: string;
  domain: GoalDomain;
  year: number;
}

/** Data to create the parent goal row. */
export interface CreateGoalData extends GoalKey {
  unit: string;
  createdBy?: string | null;
}

/**
 * One canonical hour to upsert. `value` is kept as a string (numeric column) to
 * preserve precision end-to-end — the service formats numbers; the repo never
 * rounds.
 */
export interface GoalHourUpsert {
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  value: string; // numeric, as a string
  sourceLevel: GoalSourceLevel; // YEAR | MONTH | DAY | HOUR
  derived: boolean; // true = system-distributed
  updatedBy?: string | null;
}

/** Scope for deleting hour rows; omit a field to leave that level unconstrained. */
export interface GoalHourScope {
  month?: number;
  day?: number;
  hour?: number;
}

/** A history row to append (the version it produced is supplied by the caller). */
/** One compact bucket sample stored in `details` for the timeline breakdown. */
export interface GoalHistoryDetail {
  ref: string; // "2026-03-15T08"
  value: number | null; // value at the bucket level (null on delete)
}

export interface GoalHistoryAppend {
  goalId: string;
  actor?: string | null;
  source: GoalHistorySource; // IMPORT | REPLACE | MERGE | DELETE | EDIT
  actionLevel: GoalSourceLevel; // YEAR | MONTH | DAY | HOUR
  bucketRef: string; // "2026" | "2026-03" | "2026-03-15" | "2026-03-15T08"
  oldValue?: string | null; // at the input level; NULL on create
  newValue?: string | null; // at the input level; NULL on delete / multi-bucket op
  bucketCount: number; // operator buckets this operation carried
  details?: GoalHistoryDetail[]; // compact sample for the timeline
  distributed: boolean;
  hoursAffected: number;
  version: number; // the version this change produced
}

export type GoalHistorySource = 'IMPORT' | 'REPLACE' | 'MERGE' | 'DELETE' | 'EDIT';

/** Default aggregation config per domain (DEC: fixed; seed if missing). */
const DEFAULT_DOMAIN_CONFIG: Record<GoalDomain, { aggregationMethod: GoalAggregationMethod; unit: string }> = {
  ENERGY: { aggregationMethod: 'SUM', unit: 'kWh' },
  WATER: { aggregationMethod: 'SUM', unit: 'm3' },
  TEMPERATURE: { aggregationMethod: 'AVERAGE', unit: 'C' },
};

export class ConsumptionGoalRepository {
  // ---------------------------------------------------------------------------
  // Transaction boundary
  // ---------------------------------------------------------------------------

  /**
   * Runs `fn` inside a single DB transaction, handing it a `tx` to pass to the
   * other methods. The service uses this to make upsert + version bump + history
   * append atomic.
   */
  async withTransaction<T>(fn: (tx: GoalTx) => Promise<T>): Promise<T> {
    return db.transaction(fn);
  }

  // ---------------------------------------------------------------------------
  // Parent goal
  // ---------------------------------------------------------------------------

  /** Finds the parent goal by (tenant, customer, domain, year). */
  async findGoal(key: GoalKey, exec: GoalDbClient = db): Promise<ConsumptionGoalRow | null> {
    const [row] = await exec
      .select()
      .from(consumptionGoals)
      .where(
        and(
          eq(consumptionGoals.tenantId, key.tenantId),
          eq(consumptionGoals.customerId, key.customerId),
          eq(consumptionGoals.domain, key.domain),
          eq(consumptionGoals.year, key.year),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  /** Finds the parent goal by its id (tenant-scoped). */
  async findGoalById(tenantId: string, goalId: string, exec: GoalDbClient = db): Promise<ConsumptionGoalRow | null> {
    const [row] = await exec
      .select()
      .from(consumptionGoals)
      .where(and(eq(consumptionGoals.tenantId, tenantId), eq(consumptionGoals.id, goalId)))
      .limit(1);

    return row ?? null;
  }

  /** Lists every parent goal for a customer (used by the "list domains" summary). */
  async listGoalsForCustomer(
    tenantId: string,
    customerId: string,
    exec: GoalDbClient = db,
  ): Promise<ConsumptionGoalRow[]> {
    return exec
      .select()
      .from(consumptionGoals)
      .where(and(eq(consumptionGoals.tenantId, tenantId), eq(consumptionGoals.customerId, customerId)))
      .orderBy(consumptionGoals.domain, desc(consumptionGoals.year));
  }

  /** Inserts the parent goal row (version starts at 1 per schema default). */
  async createGoal(data: CreateGoalData, exec: GoalDbClient = db): Promise<ConsumptionGoalRow> {
    const [row] = await exec
      .insert(consumptionGoals)
      .values({
        tenantId: data.tenantId,
        customerId: data.customerId,
        domain: data.domain,
        year: data.year,
        unit: data.unit,
        createdBy: data.createdBy ?? null,
        updatedBy: data.createdBy ?? null,
      })
      .returning();

    return row;
  }

  /**
   * Finds the parent goal, creating it if absent. Convenience for the write path
   * (PUT/PATCH/import-confirm) where a `(domain, year)` may be brand new.
   */
  async findOrCreateGoal(data: CreateGoalData, exec: GoalDbClient = db): Promise<ConsumptionGoalRow> {
    const existing = await this.findGoal(data, exec);
    if (existing) return existing;
    return this.createGoal(data, exec);
  }

  /**
   * Optimistic version bump. Atomically does
   *   `UPDATE ... SET version = version + 1, updated_at = now() WHERE id = ? AND version = ?`
   * Returns the updated row when the guard matched, or `null` when it did not
   * (i.e. a version conflict — the service maps `null` to a 409 / ConflictError
   * carrying the current version).
   *
   * Pass `expectedVersion` as `undefined` to force-write (skip the optimistic
   * guard); the bump then matches on id alone.
   */
  async bumpVersion(
    goalId: string,
    expectedVersion: number | undefined,
    updatedBy: string | null | undefined,
    exec: GoalDbClient = db,
  ): Promise<ConsumptionGoalRow | null> {
    const guard =
      expectedVersion === undefined
        ? eq(consumptionGoals.id, goalId)
        : and(eq(consumptionGoals.id, goalId), eq(consumptionGoals.version, expectedVersion));

    const [row] = await exec
      .update(consumptionGoals)
      .set({
        version: sqlIncrement(),
        updatedAt: new Date(),
        updatedBy: updatedBy ?? null,
      })
      .where(guard)
      .returning();

    return row ?? null;
  }

  /** Deletes the parent goal (cascades to its hours via FK). Returns rows removed. */
  async deleteGoal(goalId: string, exec: GoalDbClient = db): Promise<number> {
    const rows = await exec.delete(consumptionGoals).where(eq(consumptionGoals.id, goalId)).returning({
      id: consumptionGoals.id,
    });
    return rows.length;
  }

  // ---------------------------------------------------------------------------
  // Hours (canonical grain)
  // ---------------------------------------------------------------------------

  /** Reads all hour rows for a goal (ordered for deterministic roll-up on read). */
  async findHours(goalId: string, exec: GoalDbClient = db): Promise<ConsumptionGoalHourRow[]> {
    return exec
      .select()
      .from(consumptionGoalHours)
      .where(eq(consumptionGoalHours.goalId, goalId))
      .orderBy(consumptionGoalHours.month, consumptionGoalHours.day, consumptionGoalHours.hour);
  }

  /**
   * Bulk upsert of hour rows. Conflict target is the unique
   * `(goal_id, month, day, hour)` — on conflict the value/sourceLevel/derived
   * are overwritten (the service decides which hours to send; the repo writes
   * exactly what it is given). No-op on an empty array.
   */
  async upsertHours(goalId: string, hours: GoalHourUpsert[], exec: GoalDbClient = db): Promise<number> {
    if (hours.length === 0) return 0;

    const now = new Date();
    const values = hours.map((h) => ({
      goalId,
      month: h.month,
      day: h.day,
      hour: h.hour,
      value: h.value,
      sourceLevel: h.sourceLevel,
      derived: h.derived,
      updatedAt: now,
      updatedBy: h.updatedBy ?? null,
    }));

    // A full year of hour rows (8760) × 9 bound columns blows past postgres'
    // 65534-parameter limit in a single INSERT, so chunk the upsert. With 9
    // columns the hard cap is floor(65534/9)=7281 rows; 1000 keeps a wide margin.
    const CHUNK_SIZE = 1000;
    let affected = 0;
    for (let i = 0; i < values.length; i += CHUNK_SIZE) {
      const chunk = values.slice(i, i + CHUNK_SIZE);
      const rows = await exec
        .insert(consumptionGoalHours)
        .values(chunk)
        .onConflictDoUpdate({
          target: [
            consumptionGoalHours.goalId,
            consumptionGoalHours.month,
            consumptionGoalHours.day,
            consumptionGoalHours.hour,
          ],
          set: {
            value: sqlExcluded('value'),
            sourceLevel: sqlExcluded('source_level'),
            derived: sqlExcluded('derived'),
            updatedAt: now,
            updatedBy: sqlExcluded('updated_by'),
          },
        })
        .returning({ goalId: consumptionGoalHours.goalId });
      affected += rows.length;
    }

    return affected;
  }

  /**
   * Deletes hour rows for a goal. With no `scope` it removes every hour (used by
   * PUT-replace before re-writing, and by a whole-year delete). A `scope`
   * narrows to a month / day / hour bucket (sub-bucket delete).
   */
  async deleteHours(goalId: string, scope: GoalHourScope = {}, exec: GoalDbClient = db): Promise<number> {
    const conditions = [eq(consumptionGoalHours.goalId, goalId)];
    if (scope.month !== undefined) conditions.push(eq(consumptionGoalHours.month, scope.month));
    if (scope.day !== undefined) conditions.push(eq(consumptionGoalHours.day, scope.day));
    if (scope.hour !== undefined) conditions.push(eq(consumptionGoalHours.hour, scope.hour));

    const rows = await exec
      .delete(consumptionGoalHours)
      .where(and(...conditions))
      .returning({ goalId: consumptionGoalHours.goalId });

    return rows.length;
  }

  // ---------------------------------------------------------------------------
  // History (append-only)
  // ---------------------------------------------------------------------------

  /** Appends a single history row. */
  async appendHistory(entry: GoalHistoryAppend, exec: GoalDbClient = db): Promise<ConsumptionGoalHistoryRow> {
    const [row] = await exec
      .insert(consumptionGoalHistory)
      .values({
        goalId: entry.goalId,
        actor: entry.actor ?? null,
        source: entry.source,
        actionLevel: entry.actionLevel,
        bucketRef: entry.bucketRef,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        bucketCount: entry.bucketCount,
        details: entry.details ?? [],
        distributed: entry.distributed,
        hoursAffected: entry.hoursAffected,
        version: entry.version,
      })
      .returning();

    return row;
  }

  /** Reads history for a goal, newest-first, capped at `limit` (default 100). */
  async findHistory(goalId: string, limit = 100, exec: GoalDbClient = db): Promise<ConsumptionGoalHistoryRow[]> {
    return exec
      .select()
      .from(consumptionGoalHistory)
      .where(eq(consumptionGoalHistory.goalId, goalId))
      .orderBy(desc(consumptionGoalHistory.changedAt))
      .limit(limit);
  }

  // ---------------------------------------------------------------------------
  // Domain aggregation config (fixed per domain; seeded on demand)
  // ---------------------------------------------------------------------------

  /** Reads the aggregation config for a (tenant, domain), or null if unseeded. */
  async findDomainConfig(
    tenantId: string,
    domain: GoalDomain,
    exec: GoalDbClient = db,
  ): Promise<ConsumptionGoalDomainRow | null> {
    const [row] = await exec
      .select()
      .from(consumptionGoalDomains)
      .where(and(eq(consumptionGoalDomains.tenantId, tenantId), eq(consumptionGoalDomains.domain, domain)))
      .limit(1);

    return row ?? null;
  }

  /** Lists every aggregation config for a tenant. */
  async listDomainConfigs(tenantId: string, exec: GoalDbClient = db): Promise<ConsumptionGoalDomainRow[]> {
    return exec
      .select()
      .from(consumptionGoalDomains)
      .where(eq(consumptionGoalDomains.tenantId, tenantId));
  }

  /**
   * Reads the aggregation config for a (tenant, domain), seeding the ratified
   * default (ENERGY/WATER=SUM, TEMPERATURE=AVERAGE) when the tenant has no row
   * yet. Idempotent — a concurrent seed is absorbed by `onConflictDoNothing`,
   * after which the existing row is returned.
   */
  async getOrSeedDomainConfig(
    tenantId: string,
    domain: GoalDomain,
    exec: GoalDbClient = db,
  ): Promise<ConsumptionGoalDomainRow> {
    const existing = await this.findDomainConfig(tenantId, domain, exec);
    if (existing) return existing;

    const def = DEFAULT_DOMAIN_CONFIG[domain];
    const [seeded] = await exec
      .insert(consumptionGoalDomains)
      .values({
        tenantId,
        domain,
        aggregationMethod: def.aggregationMethod,
        unit: def.unit,
      })
      .onConflictDoNothing({ target: [consumptionGoalDomains.tenantId, consumptionGoalDomains.domain] })
      .returning();

    if (seeded) return seeded;

    // Lost the race — another writer seeded it first; read it back.
    const row = await this.findDomainConfig(tenantId, domain, exec);
    if (!row) {
      // Should be unreachable: the row exists after a conflict-do-nothing.
      throw new Error(`Failed to seed consumption goal domain config for ${domain}`);
    }
    return row;
  }
}

// -----------------------------------------------------------------------------
// Small SQL helpers (kept local so the call sites read cleanly).
// -----------------------------------------------------------------------------

/** `version = version + 1` increment expression for the parent bump. */
function sqlIncrement() {
  return sql`${consumptionGoals.version} + 1`;
}

/** References an `excluded.<column>` value inside an upsert's update set. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

// Singleton, mirroring `deviceSyncJobRepository`.
export const consumptionGoalRepository = new ConsumptionGoalRepository();
