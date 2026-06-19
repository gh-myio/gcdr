// =============================================================================
// RFC-0046 — Customer Consumption Goals: service (business logic)
//
// Owns the ratified storage rules on top of `consumptionGoalRepository`:
//
//   DEC-1  Always-hourly canonical storage. The hour is the only stored grain;
//          coarser views are derived on read, never materialised.
//   DEC-2  Roll-up on read = SUM(hours) (SUM domains) or weighted AVG by hour
//          count (AVERAGE/TEMPERATURE).
//   DEC-3  Distribution on write: SUM → even split (parent / hoursInScope);
//          AVERAGE → copy parent to every hour in scope.
//   DEC-4  Optimistic `version` on the parent, bumped per change; the hour
//          upsert + version bump + history append run in ONE transaction.
//          A version mismatch raises VersionConflictError (409) carrying the
//          current version.
//   DEC-5  PUT = replace the whole (year, domain); PATCH = merge sent buckets.
//   DEC-6  aggregation_method is fixed per domain, read from
//          consumption_goal_domains (seeded on demand).
//
// Re-distribution on a coarser edit overwrites only system-distributed
// (derived=true) hours by default; operator-confirmed (derived=false) hours are
// preserved.
//
// Numbers: hour values are kept as strings end-to-end through the repository to
// preserve numeric precision; the service formats on the boundary only.
// =============================================================================

import {
  consumptionGoalRepository,
  type ConsumptionGoalRepository,
  type ConsumptionGoalRow,
  type ConsumptionGoalHourRow,
  type ConsumptionGoalHistoryRow,
  type GoalHourUpsert,
  type GoalHistorySource,
  type GoalHistoryDetail,
  type GoalKey,
  type GoalTx,
} from '../repositories/consumptionGoalRepository';
import {
  daysInMonth,
  isValidValueForDomain,
  type GoalAggregationMethod,
  type GoalDomain,
  type GoalGranularity,
  type GoalSourceLevel,
  type ReplaceGoalsBodyDTO,
  type MergeGoalsBodyDTO,
  type DeleteGoalsBodyDTO,
} from '../dto/request/GoalsDTO';
import { ValidationError, NotFoundError, AppError } from '../shared/errors/AppError';

// -----------------------------------------------------------------------------
// 409 — optimistic version conflict
//
// The project ships a generic `ConflictError` (code CONFLICT). RFC-0046 §4.4
// requires code `VERSION_CONFLICT` with `currentVersion` in the body, so the
// service raises this richer subclass; the controller serialises its `details`
// and `currentVersion` directly (the global error handler only emits
// message+code for a bare AppError).
// -----------------------------------------------------------------------------

export class VersionConflictError extends AppError {
  public readonly currentVersion: number;
  public readonly details: Record<string, unknown>;

  constructor(currentVersion: number, expectedVersion: number | undefined, domain: GoalDomain, year: number) {
    super('VERSION_CONFLICT', 'Version conflict: goal was modified by another change', 409);
    this.currentVersion = currentVersion;
    this.details = { expectedVersion, currentVersion, domain, year };
  }
}

// -----------------------------------------------------------------------------
// Derived-tree response shapes (mirrors RFC-0046-Goals-API §3.2)
// -----------------------------------------------------------------------------

export interface GoalTreeNode {
  value: number;
  method: GoalAggregationMethod;
  /** Finest level the operator set within the node; absent on the pure annual root. */
  sourceLevel?: GoalSourceLevel;
  /** true = every contributing hour was system-distributed. */
  derived?: boolean;
}

export interface GoalTree {
  annual?: GoalTreeNode;
  monthly?: Record<string, GoalTreeNode>;
  daily?: Record<string, GoalTreeNode>;
  hourly?: Record<string, GoalTreeNode>;
}

export interface GoalHistoryEntry {
  source: GoalHistorySource;
  actionLevel: GoalSourceLevel;
  bucketRef: string;
  oldValue: number | null;
  newValue: number | null;
  bucketCount: number;
  details: GoalHistoryDetail[];
  distributed: boolean;
  hoursAffected: number;
  version: number;
  actor: string | null;
  changedAt: string;
}

export interface GoalGetResult {
  customerId: string;
  domain: GoalDomain;
  unit: string;
  aggregationMethod: GoalAggregationMethod;
  year: number;
  version: number;
  tree: GoalTree;
  history?: GoalHistoryEntry[];
}

export interface GoalWriteResult extends GoalGetResult {
  distribution: { hoursWritten: number; actionLevel: GoalSourceLevel };
}

export interface GoalDomainSummary {
  domain: GoalDomain;
  unit: string;
  aggregationMethod: GoalAggregationMethod;
  years: Array<{ year: number; version: number }>;
}

export interface GoalListResult {
  customerId: string;
  domains: GoalDomainSummary[];
}

export interface GoalDeleteResult {
  customerId: string;
  domain: GoalDomain;
  year: number;
  deleted: { bucket: string | null; hoursRemoved: number; actionLevel: GoalSourceLevel };
  version: number;
}

// Import (stateless dryRun — DEC e)
export interface ImportDiagnostic {
  line: number;
  bucket?: string;
  value?: number;
  reason: string;
}

export interface ImportResult {
  dryRun: boolean;
  preview: GoalTree;
  diagnostics: ImportDiagnostic[];
  okCount: number;
  errorCount: number;
  /** present on persist (dryRun=false) */
  version?: number;
  /** present on persist (dryRun=false) — human-readable per-bucket log lines */
  log?: string[];
}

// -----------------------------------------------------------------------------
// Internal value-bucket model used by every write path
//
// A "bucket" is one operator-set value at a declared level. The service expands
// each bucket to the canonical hour rows it covers.
// -----------------------------------------------------------------------------

interface ValueBucket {
  level: GoalSourceLevel;
  /** month 1..12 (undefined for YEAR). */
  month?: number;
  /** day 1..31 (undefined for YEAR/MONTH). */
  day?: number;
  /** hour 0..23 (undefined for YEAR/MONTH/DAY). */
  hour?: number;
  value: number;
  /** bucketRef for history, e.g. "2026" | "2026-03" | "2026-03-15" | "2026-03-15T08". */
  ref: string;
}

const SUM_AGG: GoalAggregationMethod = 'SUM';

/** Max bucket samples persisted in a history row's `details` (timeline breakdown). */
const HISTORY_DETAIL_CAP = 50;

// =============================================================================
// Service
// =============================================================================

export class ConsumptionGoalService {
  constructor(private readonly repo: ConsumptionGoalRepository = consumptionGoalRepository) {}

  // ---------------------------------------------------------------------------
  // Calendar helpers (leap-year aware)
  // ---------------------------------------------------------------------------

  /** Hours covered by a bucket scope of the given level, for a (year). */
  private hoursInScope(level: GoalSourceLevel, year: number, month?: number, _day?: number): number {
    switch (level) {
      case 'HOUR':
        return 1;
      case 'DAY':
        return 24;
      case 'MONTH': {
        if (month === undefined) throw new ValidationError('month required for MONTH scope');
        return daysInMonth(year, month) * 24;
      }
      case 'YEAR': {
        let total = 0;
        for (let m = 1; m <= 12; m++) total += daysInMonth(year, m);
        return total * 24;
      }
      default:
        throw new ValidationError(`Unknown level: ${level}`);
    }
  }

  /** Iterates every (month, day, hour) in scope, calling `fn` for each. */
  private forEachHourInScope(
    level: GoalSourceLevel,
    year: number,
    scope: { month?: number; day?: number; hour?: number },
    fn: (month: number, day: number, hour: number) => void,
  ): void {
    const months = level === 'YEAR' ? range(1, 12) : [scope.month!];
    for (const m of months) {
      const days =
        level === 'YEAR' || level === 'MONTH' ? range(1, daysInMonth(year, m)) : [scope.day!];
      for (const d of days) {
        const hours = level === 'HOUR' ? [scope.hour!] : range(0, 23);
        for (const h of hours) fn(m, d, h);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Distribution (bucket → canonical hour rows) — DEC-3
  // ---------------------------------------------------------------------------

  /**
   * Expands one value bucket into the hour upserts it covers.
   *   SUM     → even split: each hour = value / hoursInScope
   *   AVERAGE → copy: each hour = value
   * Generated hours carry `sourceLevel` = the bucket's level and `derived` =
   * true for every hour except the exact HOUR a HOUR-level bucket names.
   */
  private distributeBucket(
    bucket: ValueBucket,
    year: number,
    method: GoalAggregationMethod,
    updatedBy: string | null,
  ): GoalHourUpsert[] {
    const hours: GoalHourUpsert[] = [];
    const scope = { month: bucket.month, day: bucket.day, hour: bucket.hour };
    const count = this.hoursInScope(bucket.level, year, bucket.month, bucket.day);
    const perHour = method === SUM_AGG ? bucket.value / count : bucket.value;
    // A HOUR-level bucket is operator-confirmed for the exact hour it names.
    const derived = bucket.level !== 'HOUR';

    this.forEachHourInScope(bucket.level, year, scope, (m, d, h) => {
      hours.push({
        month: m,
        day: d,
        hour: h,
        value: formatNumeric(perHour),
        sourceLevel: bucket.level,
        derived,
        updatedBy,
      });
    });

    return hours;
  }

  // ---------------------------------------------------------------------------
  // Roll-up (hour rows → derived tree) — DEC-2
  // ---------------------------------------------------------------------------

  /**
   * Reduces hour rows to a node value at the requested method:
   *   SUM     → sum of hour values
   *   AVERAGE → weighted average by hour count (= simple mean of equal-weight hours)
   * Also computes the aggregated `sourceLevel`/`derived`:
   *   derived = true only when EVERY contributing hour is derived; the reported
   *   sourceLevel is the finest level any contributing hour was set at.
   */
  private reduceHours(rows: ConsumptionGoalHourRow[], method: GoalAggregationMethod): GoalTreeNode {
    let acc = 0;
    let anyConfirmed = false;
    let finestLevel: GoalSourceLevel | undefined;

    for (const r of rows) {
      acc += Number(r.value);
      if (!r.derived) anyConfirmed = true;
      finestLevel = finerLevel(finestLevel, r.sourceLevel as GoalSourceLevel);
    }

    const value = method === SUM_AGG ? acc : rows.length > 0 ? acc / rows.length : 0;

    return {
      value: roundOut(value),
      method,
      sourceLevel: finestLevel,
      derived: rows.length > 0 ? !anyConfirmed : undefined,
    };
  }

  /** Builds the derived tree at the requested granularity from all hour rows. */
  private buildTree(
    rows: ConsumptionGoalHourRow[],
    granularity: GoalGranularity,
    method: GoalAggregationMethod,
  ): GoalTree {
    const tree: GoalTree = {};

    // annual is always present when there are any hours
    tree.annual = stripAggMeta(this.reduceHours(rows, method));

    if (granularity === 'year') return tree;

    // monthly
    const byMonth = groupBy(rows, (r) => pad2(r.month));
    tree.monthly = {};
    for (const [mKey, mRows] of Object.entries(byMonth)) {
      tree.monthly[mKey] = this.reduceHours(mRows, method);
    }

    if (granularity === 'month') return tree;

    // daily keyed MM-DD
    const byDay = groupBy(rows, (r) => `${pad2(r.month)}-${pad2(r.day)}`);
    tree.daily = {};
    for (const [dKey, dRows] of Object.entries(byDay)) {
      tree.daily[dKey] = this.reduceHours(dRows, method);
    }

    if (granularity === 'day') return tree;

    // hourly keyed MM-DDThh
    tree.hourly = {};
    for (const r of rows) {
      const key = `${pad2(r.month)}-${pad2(r.day)}T${pad2(r.hour)}`;
      tree.hourly[key] = this.reduceHours([r], method);
    }

    return tree;
  }

  // ---------------------------------------------------------------------------
  // Domain config (fixed per domain; seeded on demand) — DEC-6
  // ---------------------------------------------------------------------------

  private async resolveDomainConfig(tenantId: string, domain: GoalDomain) {
    const cfg = await this.repo.getOrSeedDomainConfig(tenantId, domain);
    return { aggregationMethod: cfg.aggregationMethod as GoalAggregationMethod, unit: cfg.unit };
  }

  // ---------------------------------------------------------------------------
  // GET — list domains with goals (RFC §3.1)
  // ---------------------------------------------------------------------------

  async list(tenantId: string, customerId: string): Promise<GoalListResult> {
    const goals = await this.repo.listGoalsForCustomer(tenantId, customerId);

    // Group years per domain.
    const byDomain = new Map<GoalDomain, Array<{ year: number; version: number }>>();
    for (const g of goals) {
      const d = g.domain as GoalDomain;
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d)!.push({ year: g.year, version: g.version });
    }

    // Emit a summary per domain that has any goals, with its fixed config.
    const domains: GoalDomainSummary[] = [];
    for (const [domain, years] of byDomain.entries()) {
      const cfg = await this.resolveDomainConfig(tenantId, domain);
      years.sort((a, b) => b.year - a.year);
      domains.push({ domain, unit: cfg.unit, aggregationMethod: cfg.aggregationMethod, years });
    }
    domains.sort((a, b) => a.domain.localeCompare(b.domain));

    return { customerId, domains };
  }

  // ---------------------------------------------------------------------------
  // GET — derived tree (RFC §3.2)
  // ---------------------------------------------------------------------------

  async get(
    key: GoalKey,
    granularity: GoalGranularity,
    fetchHistory: boolean,
  ): Promise<GoalGetResult> {
    const cfg = await this.resolveDomainConfig(key.tenantId, key.domain);
    const goal = await this.repo.findGoal(key);

    // No goal yet → version 0, empty tree (RFC §3.2).
    if (!goal) {
      return {
        customerId: key.customerId,
        domain: key.domain,
        unit: cfg.unit,
        aggregationMethod: cfg.aggregationMethod,
        year: key.year,
        version: 0,
        tree: {},
        ...(fetchHistory ? { history: [] } : {}),
      };
    }

    const rows = await this.repo.findHours(goal.id);
    const tree = rows.length === 0 ? {} : this.buildTree(rows, granularity, cfg.aggregationMethod);

    const result: GoalGetResult = {
      customerId: key.customerId,
      domain: key.domain,
      unit: goal.unit,
      aggregationMethod: cfg.aggregationMethod,
      year: key.year,
      version: goal.version,
      tree,
    };

    if (fetchHistory) {
      const hist = await this.repo.findHistory(goal.id, 100);
      result.history = hist.map(mapHistoryRow);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // PUT — replace whole (year, domain) (RFC §3.3, DEC-5)
  // ---------------------------------------------------------------------------

  async replace(
    key: GoalKey,
    body: ReplaceGoalsBodyDTO,
    actor: string | null,
  ): Promise<GoalWriteResult> {
    const cfg = await this.resolveDomainConfig(key.tenantId, key.domain);
    const buckets = this.flattenReplaceBody(body, key.domain, key.year);

    // The action level recorded in history = the coarsest level the operator set.
    const actionLevel = coarsestLevel(buckets.map((b) => b.level));

    const result = await this.repo.withTransaction(async (tx) => {
      const { goal, created } = await this.openGoalForWrite(key, cfg.unit, body.expectedVersion, actor, tx);

      // REPLACE: wipe every hour, then write exactly the submitted scope.
      await this.repo.deleteHours(goal.id, {}, tx);

      const hours = this.materialiseBuckets(buckets, key.year, cfg.aggregationMethod, actor);
      const hoursWritten = await this.repo.upsertHours(goal.id, hours, tx);

      const final = await this.commitVersion(goal, created, body.expectedVersion, actor, key, tx);

      await this.appendOperation(goal.id, 'REPLACE', buckets, final.version, actor, tx);

      return { goal: final, hoursWritten, actionLevel };
    });

    const tree = await this.readTreeAt(result.goal.id, granularityOf(actionLevel), cfg.aggregationMethod);
    return {
      customerId: key.customerId,
      domain: key.domain,
      unit: cfg.unit,
      aggregationMethod: cfg.aggregationMethod,
      year: key.year,
      version: result.goal.version,
      tree,
      distribution: { hoursWritten: result.hoursWritten, actionLevel: result.actionLevel },
    };
  }

  // ---------------------------------------------------------------------------
  // PATCH — merge sent buckets (RFC §3.4, DEC-5)
  // ---------------------------------------------------------------------------

  async merge(
    key: GoalKey,
    body: MergeGoalsBodyDTO,
    actor: string | null,
  ): Promise<GoalWriteResult> {
    const cfg = await this.resolveDomainConfig(key.tenantId, key.domain);
    const buckets = this.parseMergeBuckets(body, key.domain, key.year);
    const actionLevel = coarsestLevel(buckets.map((b) => b.level));

    const result = await this.repo.withTransaction(async (tx) => {
      const { goal, created } = await this.openGoalForWrite(key, cfg.unit, body.expectedVersion, actor, tx);

      // MERGE: re-distribute only the sent buckets. For each bucket we overwrite
      // its derived hours; operator-confirmed hours are preserved by re-applying
      // them on top (read existing scope, keep derived=false ones unchanged).
      const existing = await this.repo.findHours(goal.id, tx);
      const hours = this.mergeBuckets(existing, buckets, key.year, cfg.aggregationMethod, actor);
      const hoursWritten = await this.repo.upsertHours(goal.id, hours, tx);

      const final = await this.commitVersion(goal, created, body.expectedVersion, actor, key, tx);

      await this.appendOperation(goal.id, 'MERGE', buckets, final.version, actor, tx);

      return { goal: final, hoursWritten, actionLevel };
    });

    const tree = await this.readTreeAt(result.goal.id, granularityOf(actionLevel), cfg.aggregationMethod);
    return {
      customerId: key.customerId,
      domain: key.domain,
      unit: cfg.unit,
      aggregationMethod: cfg.aggregationMethod,
      year: key.year,
      version: result.goal.version,
      tree,
      distribution: { hoursWritten: result.hoursWritten, actionLevel: result.actionLevel },
    };
  }

  // ---------------------------------------------------------------------------
  // IMPORT — stateless dryRun (DEC e)
  // ---------------------------------------------------------------------------

  /**
   * Parses pipe/CSV `content` into buckets.
   *   dryRun=true  → returns { preview, diagnostics, okCount, errorCount } WITHOUT
   *                  persisting.
   *   dryRun=false → applies via MERGE semantics and returns the same plus a log.
   * There is NO previewToken — the same payload is re-sent with dryRun:false.
   */
  async importData(
    key: GoalKey,
    content: string,
    dryRun: boolean,
    expectedVersion: number | undefined,
    actor: string | null,
  ): Promise<ImportResult> {
    const cfg = await this.resolveDomainConfig(key.tenantId, key.domain);
    const { buckets, diagnostics } = this.parseImport(content, key.domain, key.year);
    const okCount = buckets.length;
    const errorCount = diagnostics.length;

    if (dryRun) {
      // Build a preview tree WITHOUT touching the DB: merge the parsed buckets on
      // top of the current hours and roll up.
      const goal = await this.repo.findGoal(key);
      const existing = goal ? await this.repo.findHours(goal.id) : [];
      const merged = this.mergeBuckets(existing, buckets, key.year, cfg.aggregationMethod, actor);
      const previewRows = this.simulateRows(existing, merged);
      const preview =
        previewRows.length === 0 ? {} : this.buildTree(previewRows, 'month', cfg.aggregationMethod);
      return { dryRun: true, preview, diagnostics, okCount, errorCount };
    }

    // Persist via merge semantics.
    if (buckets.length === 0) {
      throw new ValidationError('Import has no valid lines to apply', {
        csv: ['every line was invalid or empty'],
      });
    }

    const persisted = await this.repo.withTransaction(async (tx) => {
      const { goal, created } = await this.openGoalForWrite(key, cfg.unit, expectedVersion, actor, tx);

      const existing = await this.repo.findHours(goal.id, tx);
      const hours = this.mergeBuckets(existing, buckets, key.year, cfg.aggregationMethod, actor);
      await this.repo.upsertHours(goal.id, hours, tx);

      const final = await this.commitVersion(goal, created, expectedVersion, actor, key, tx);
      await this.appendOperation(goal.id, 'IMPORT', buckets, final.version, actor, tx);

      const rows = await this.repo.findHours(goal.id, tx);
      return { goal: final, rows };
    });

    const preview =
      persisted.rows.length === 0 ? {} : this.buildTree(persisted.rows, 'month', cfg.aggregationMethod);
    const log = buckets.map((b) => `applied ${b.level} ${b.ref} = ${b.value}`);

    return {
      dryRun: false,
      preview,
      diagnostics,
      okCount,
      errorCount,
      version: persisted.goal.version,
      log,
    };
  }

  // ---------------------------------------------------------------------------
  // DELETE — year or sub-bucket (RFC §3.6)
  // ---------------------------------------------------------------------------

  async remove(
    key: GoalKey,
    body: DeleteGoalsBodyDTO,
    actor: string | null,
  ): Promise<GoalDeleteResult | null> {
    const goal = await this.repo.findGoal(key);
    if (!goal) {
      throw new NotFoundError(`No ${key.domain} goal for year ${key.year}`);
    }

    const bucket = body?.bucket;
    const expectedVersion = body?.expectedVersion;

    // Whole-year delete with no sub-bucket → remove parent (cascade) entirely.
    if (!bucket) {
      this.assertVersion(goal, expectedVersion, key);
      // bump-guard first so an expectedVersion mismatch 409s before we delete.
      if (expectedVersion !== undefined) {
        const guarded = await this.repo.bumpVersion(goal.id, expectedVersion, actor);
        if (!guarded) {
          const cur = await this.repo.findGoalById(key.tenantId, goal.id);
          throw new VersionConflictError(cur?.version ?? goal.version, expectedVersion, key.domain, key.year);
        }
      }
      const removed = await this.repo.deleteHours(goal.id);
      await this.repo.deleteGoal(goal.id);
      return {
        customerId: key.customerId,
        domain: key.domain,
        year: key.year,
        deleted: { bucket: null, hoursRemoved: removed, actionLevel: 'YEAR' },
        version: 0,
      };
    }

    // Sub-bucket delete: remove its hours, bump version, append history.
    const parsed = this.parseBucketRef(bucket.level, bucket.ref, key.year);
    const scope = { month: parsed.month, day: parsed.day, hour: parsed.hour };

    const result = await this.repo.withTransaction(async (tx) => {
      this.assertVersion(goal, expectedVersion, key);
      const hoursRemoved = await this.repo.deleteHours(goal.id, scope, tx);
      const bumped = await this.bumpOrConflict(goal, expectedVersion, actor, key, tx);
      await this.repo.appendHistory(
        {
          goalId: goal.id,
          actor,
          source: 'DELETE',
          actionLevel: bucket.level,
          bucketRef: bucket.ref,
          oldValue: null,
          newValue: null,
          bucketCount: 1,
          details: [{ ref: bucket.ref, value: null }],
          distributed: true,
          hoursAffected: hoursRemoved,
          version: bumped.version,
        },
        tx,
      );
      return { version: bumped.version, hoursRemoved };
    });

    return {
      customerId: key.customerId,
      domain: key.domain,
      year: key.year,
      deleted: { bucket: bucket.ref, hoursRemoved: result.hoursRemoved, actionLevel: bucket.level },
      version: result.version,
    };
  }

  // ===========================================================================
  // Internal write helpers
  // ===========================================================================

  /**
   * Opens (find-or-create) the parent goal for a write and applies the early
   * optimistic guard. Reports `created` so the caller can skip the version bump
   * on a brand-new goal — a first write lands on version 1, matching the RFC
   * worked example (0 → 1), not 2.
   */
  private async openGoalForWrite(
    key: GoalKey,
    unit: string,
    expected: number | undefined,
    actor: string | null,
    tx: GoalTx,
  ): Promise<{ goal: ConsumptionGoalRow; created: boolean }> {
    const existing = await this.repo.findGoal(key, tx);
    if (existing) {
      this.assertVersion(existing, expected, key);
      return { goal: existing, created: false };
    }
    const goal = await this.repo.createGoal({ ...key, unit, createdBy: actor }, tx);
    return { goal, created: true };
  }

  /**
   * Settles the parent version after the hour write:
   *   - a freshly-created goal keeps its initial version 1 (the create IS the
   *     first change);
   *   - an existing goal is bumped under the optimistic guard (409 on mismatch).
   */
  private async commitVersion(
    goal: ConsumptionGoalRow,
    created: boolean,
    expected: number | undefined,
    actor: string | null,
    key: GoalKey,
    tx: GoalTx,
  ): Promise<ConsumptionGoalRow> {
    if (created) return goal;
    return this.bumpOrConflict(goal, expected, actor, key, tx);
  }

  /** Optimistic guard: throws VersionConflictError when expectedVersion mismatches. */
  private assertVersion(goal: ConsumptionGoalRow, expected: number | undefined, key: GoalKey): void {
    if (expected !== undefined && goal.version !== expected) {
      throw new VersionConflictError(goal.version, expected, key.domain, key.year);
    }
  }

  /**
   * Bumps the parent version inside `tx`, mapping a guard miss to a 409. Re-reads
   * the current version for the conflict body.
   */
  private async bumpOrConflict(
    goal: ConsumptionGoalRow,
    expected: number | undefined,
    actor: string | null,
    key: GoalKey,
    tx: GoalTx,
  ): Promise<ConsumptionGoalRow> {
    const bumped = await this.repo.bumpVersion(goal.id, expected, actor, tx);
    if (!bumped) {
      const cur = await this.repo.findGoalById(key.tenantId, goal.id, tx);
      throw new VersionConflictError(cur?.version ?? goal.version, expected, key.domain, key.year);
    }
    return bumped;
  }

  /** Materialises a set of disjoint buckets into hour upserts (replace path). */
  private materialiseBuckets(
    buckets: ValueBucket[],
    year: number,
    method: GoalAggregationMethod,
    actor: string | null,
  ): GoalHourUpsert[] {
    // Finest-wins: a later, finer bucket overrides a coarser one for the same hour.
    const map = new Map<string, GoalHourUpsert>();
    const ordered = [...buckets].sort((a, b) => levelRank(a.level) - levelRank(b.level));
    for (const b of ordered) {
      for (const h of this.distributeBucket(b, year, method, actor)) {
        map.set(hourKey(h.month, h.day, h.hour), h);
      }
    }
    return [...map.values()];
  }

  /**
   * Merge path: start from existing hours, then for each sent bucket re-distribute
   * over its scope — but preserve operator-confirmed (derived=false) hours that the
   * bucket would have touched, unless the bucket itself is HOUR-level (explicit).
   */
  private mergeBuckets(
    existing: ConsumptionGoalHourRow[],
    buckets: ValueBucket[],
    year: number,
    method: GoalAggregationMethod,
    actor: string | null,
  ): GoalHourUpsert[] {
    const confirmed = new Set<string>();
    for (const r of existing) {
      if (!r.derived) confirmed.add(hourKey(r.month, r.day, r.hour));
    }

    const out = new Map<string, GoalHourUpsert>();
    const ordered = [...buckets].sort((a, b) => levelRank(a.level) - levelRank(b.level));
    for (const b of ordered) {
      for (const h of this.distributeBucket(b, year, method, actor)) {
        const k = hourKey(h.month, h.day, h.hour);
        // Preserve operator-confirmed hours on a coarser re-distribution.
        if (b.level !== 'HOUR' && confirmed.has(k)) continue;
        out.set(k, h);
      }
    }
    return [...out.values()];
  }

  /** Overlays the upsert set onto the existing rows to simulate a post-write state. */
  private simulateRows(
    existing: ConsumptionGoalHourRow[],
    upserts: GoalHourUpsert[],
  ): ConsumptionGoalHourRow[] {
    const map = new Map<string, ConsumptionGoalHourRow>();
    for (const r of existing) map.set(hourKey(r.month, r.day, r.hour), r);
    for (const u of upserts) {
      const k = hourKey(u.month, u.day, u.hour);
      map.set(k, {
        ...(map.get(k) ?? ({} as ConsumptionGoalHourRow)),
        goalId: '',
        month: u.month,
        day: u.day,
        hour: u.hour,
        value: u.value,
        sourceLevel: u.sourceLevel,
        derived: u.derived,
        updatedAt: new Date(),
        updatedBy: u.updatedBy ?? null,
      } as ConsumptionGoalHourRow);
    }
    return [...map.values()].sort(
      (a, b) => a.month - b.month || a.day - b.day || a.hour - b.hour,
    );
  }

  /** Re-reads the goal's hours and rolls them into a tree (post-write response). */
  private async readTreeAt(
    goalId: string,
    granularity: GoalGranularity,
    method: GoalAggregationMethod,
  ): Promise<GoalTree> {
    const rows = await this.repo.findHours(goalId);
    return rows.length === 0 ? {} : this.buildTree(rows, granularity, method);
  }

  /**
   * Appends ONE audit row per operation (a mutation = a version = one entry),
   * so the UI timeline reads clean, human entries and a large import does not
   * flood the ≤100-row history window. The row records the operation `source`,
   * the coarsest level touched, the bucket count, the total hours affected, and
   * a compact `details` sample ([{ ref, value }], capped) for the breakdown.
   */
  private async appendOperation(
    goalId: string,
    source: GoalHistorySource,
    buckets: ValueBucket[],
    version: number,
    actor: string | null,
    tx: GoalTx,
  ): Promise<void> {
    if (buckets.length === 0) return;

    const actionLevel = coarsestLevel(buckets.map((b) => b.level));
    const hoursAffected = buckets.reduce((sum, b) => {
      const year = Number(b.ref.slice(0, 4));
      return sum + this.hoursInScope(b.level, year, b.month, b.day);
    }, 0);
    const details: GoalHistoryDetail[] = buckets
      .slice(0, HISTORY_DETAIL_CAP)
      .map((b) => ({ ref: b.ref, value: b.value }));

    await this.repo.appendHistory(
      {
        goalId,
        actor,
        source,
        actionLevel,
        // Representative ref: the single bucket's ref, or the coarsest scope.
        bucketRef: buckets.length === 1 ? buckets[0].ref : String(Number(buckets[0].ref.slice(0, 4))),
        oldValue: null,
        newValue: buckets.length === 1 ? formatNumeric(buckets[0].value) : null,
        bucketCount: buckets.length,
        details,
        distributed: true,
        hoursAffected,
        version,
      },
      tx,
    );
  }

  // ===========================================================================
  // Body / CSV parsing → ValueBucket[]
  // ===========================================================================

  /** Flattens a PUT replace tree into disjoint value buckets (refs are year-aware). */
  private flattenReplaceBody(body: ReplaceGoalsBodyDTO, domain: GoalDomain, year: number): ValueBucket[] {
    const buckets: ValueBucket[] = [];

    const pushCheck = (value: number, path: string) => {
      if (!isValidValueForDomain(domain, value)) {
        throw new ValidationError('Invalid goal value', {
          [path]: [
            domain === 'TEMPERATURE'
              ? 'value must be a finite number'
              : 'value must be a finite number >= 0 for energy/water domains',
          ],
        });
      }
    };

    const push = (b: Omit<ValueBucket, 'ref'>) => {
      buckets.push({ ...b, ref: bucketRefOf(b as ValueBucket, year) });
    };

    if (body.annual) {
      pushCheck(body.annual.value, 'annual.value');
      push({ level: 'YEAR', value: body.annual.value });
    }

    for (const [mKey, month] of Object.entries(body.monthly ?? {})) {
      const m = Number(mKey);
      pushCheck(month.value, `monthly.${mKey}.value`);
      const hasDaily = month.daily && Object.keys(month.daily).length > 0;
      // A month node contributes a MONTH bucket only when it has no finer children;
      // otherwise the finer DAY/HOUR buckets fully describe it (finest-wins).
      if (!hasDaily) {
        push({ level: 'MONTH', month: m, value: month.value });
      }

      for (const [dKey, day] of Object.entries(month.daily ?? {})) {
        const d = Number(dKey);
        pushCheck(day.value, `monthly.${mKey}.daily.${dKey}.value`);
        const hasHourly = day.hourly && Object.keys(day.hourly).length > 0;
        if (!hasHourly) {
          push({ level: 'DAY', month: m, day: d, value: day.value });
        }
        for (const [hKey, hour] of Object.entries(day.hourly ?? {})) {
          const h = Number(hKey);
          pushCheck(hour.value, `monthly.${mKey}.daily.${dKey}.hourly.${hKey}.value`);
          push({ level: 'HOUR', month: m, day: d, hour: h, value: hour.value });
        }
      }
    }

    return buckets;
  }

  /** Parses PATCH merge buckets (level + ref) into value buckets. */
  private parseMergeBuckets(body: MergeGoalsBodyDTO, domain: GoalDomain, year: number): ValueBucket[] {
    return body.buckets.map((b, i) => {
      if (!isValidValueForDomain(domain, b.value)) {
        throw new ValidationError('Invalid goal value', {
          [`buckets.${i}.value`]: [
            domain === 'TEMPERATURE'
              ? 'value must be a finite number'
              : 'value must be a finite number >= 0 for energy/water domains',
          ],
        });
      }
      const parsed = this.parseBucketRef(b.level, b.ref, year);
      return {
        level: b.level,
        month: parsed.month,
        day: parsed.day,
        hour: parsed.hour,
        value: b.value,
        ref: b.ref,
      };
    });
  }

  /**
   * Parses a CSV/pipe import into value buckets + line diagnostics.
   * Accepts a header line `bucket,value` (or pipe-separated). Each data line is
   * `<bucketRef><sep><value>` where bucketRef ∈ YYYY | YYYY-MM | YYYY-MM-DD |
   * YYYY-MM-DDThh. Finest-granularity wins on duplicate refs.
   */
  private parseImport(
    content: string,
    domain: GoalDomain,
    year: number,
  ): { buckets: ValueBucket[]; diagnostics: ImportDiagnostic[] } {
    const diagnostics: ImportDiagnostic[] = [];
    const buckets: ValueBucket[] = [];

    const lines = content.split(/\r?\n/);
    let dataStarted = false;

    lines.forEach((raw, idx) => {
      const lineNo = idx + 1;
      const line = raw.trim();
      if (line === '') return;

      const sep = line.includes('|') ? '|' : ',';
      const parts = line.split(sep).map((p) => p.trim());

      // Skip a header row (`bucket,value`).
      if (!dataStarted && /bucket/i.test(parts[0]) && /value/i.test(parts[1] ?? '')) {
        dataStarted = true;
        return;
      }
      dataStarted = true;

      if (parts.length < 2) {
        diagnostics.push({ line: lineNo, reason: 'expected "<bucket><sep><value>"' });
        return;
      }

      const ref = parts[0];
      const valueRaw = parts[1];
      const value = Number(valueRaw);

      const level = levelFromRef(ref);
      if (!level) {
        diagnostics.push({ line: lineNo, bucket: ref, reason: 'unrecognised bucket format' });
        return;
      }

      if (!Number.isFinite(value)) {
        diagnostics.push({ line: lineNo, bucket: ref, reason: 'value is not a finite number' });
        return;
      }
      if (!isValidValueForDomain(domain, value)) {
        diagnostics.push({
          line: lineNo,
          bucket: ref,
          value,
          reason:
            domain === 'TEMPERATURE'
              ? 'value must be finite'
              : 'value must be >= 0 for energy/water domains',
        });
        return;
      }

      let parsed;
      try {
        parsed = this.parseBucketRef(level, ref, year);
      } catch (e) {
        diagnostics.push({
          line: lineNo,
          bucket: ref,
          value,
          reason: e instanceof Error ? e.message : 'invalid bucket reference',
        });
        return;
      }

      buckets.push({ level, month: parsed.month, day: parsed.day, hour: parsed.hour, value, ref });
    });

    return { buckets, diagnostics };
  }

  /**
   * Parses a bucketRef into (month, day, hour) and validates it against the year
   * (leap-year aware). Throws ValidationError on mismatch.
   */
  private parseBucketRef(
    level: GoalSourceLevel,
    ref: string,
    year: number,
  ): { month?: number; day?: number; hour?: number } {
    const refYear = Number(ref.slice(0, 4));
    if (refYear !== year) {
      throw new ValidationError(`ref year ${refYear} does not match target year ${year}`);
    }

    if (level === 'YEAR') return {};

    const month = Number(ref.slice(5, 7));
    if (!(month >= 1 && month <= 12)) {
      throw new ValidationError(`month must be 1..12 in "${ref}"`);
    }
    if (level === 'MONTH') return { month };

    const day = Number(ref.slice(8, 10));
    const maxDay = daysInMonth(year, month);
    if (!(day >= 1 && day <= maxDay)) {
      throw new ValidationError(`day ${day} is invalid for ${year}-${pad2(month)} (max ${maxDay})`);
    }
    if (level === 'DAY') return { month, day };

    const hour = Number(ref.slice(11, 13));
    if (!(hour >= 0 && hour <= 23)) {
      throw new ValidationError(`hour must be 0..23 in "${ref}"`);
    }
    return { month, day, hour };
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

function bucketRefOf(b: ValueBucket, year: number): string {
  switch (b.level) {
    case 'YEAR':
      return `${year}`;
    case 'MONTH':
      return `${year}-${pad2(b.month!)}`;
    case 'DAY':
      return `${year}-${pad2(b.month!)}-${pad2(b.day!)}`;
    case 'HOUR':
      return `${year}-${pad2(b.month!)}-${pad2(b.day!)}T${pad2(b.hour!)}`;
  }
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hourKey(month: number, day: number, hour: number): string {
  return `${month}-${day}-${hour}`;
}

function groupBy<T>(rows: T[], keyFn: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) {
    const k = keyFn(r);
    (out[k] ??= []).push(r);
  }
  return out;
}

/** numeric column formatting — fixed precision string, trimmed of trailing zeros. */
function formatNumeric(value: number): string {
  // 10 dp keeps hour-split precision (e.g. 100000/744) without float noise.
  return value.toFixed(10);
}

/** Output rounding for derived tree values (avoids 99999.99999997 artefacts). */
function roundOut(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

const LEVEL_RANK: Record<GoalSourceLevel, number> = { YEAR: 0, MONTH: 1, DAY: 2, HOUR: 3 };

function levelRank(level: GoalSourceLevel): number {
  return LEVEL_RANK[level];
}

/** The finer (deeper) of two levels; used to report a node's sourceLevel. */
function finerLevel(a: GoalSourceLevel | undefined, b: GoalSourceLevel): GoalSourceLevel {
  if (a === undefined) return b;
  return levelRank(a) >= levelRank(b) ? a : b;
}

/** The coarsest (shallowest) level among a set — the history action level. */
function coarsestLevel(levels: GoalSourceLevel[]): GoalSourceLevel {
  let best: GoalSourceLevel = 'HOUR';
  for (const l of levels) if (levelRank(l) < levelRank(best)) best = l;
  return best;
}

/** Maps an action level to the read granularity used in the write response tree. */
function granularityOf(level: GoalSourceLevel): GoalGranularity {
  switch (level) {
    case 'YEAR':
      return 'year';
    case 'MONTH':
      return 'month';
    case 'DAY':
      return 'day';
    case 'HOUR':
      return 'hour';
  }
}

/** Detects the level implied by a bucketRef string. */
function levelFromRef(ref: string): GoalSourceLevel | null {
  if (/^\d{4}$/.test(ref)) return 'YEAR';
  if (/^\d{4}-\d{2}$/.test(ref)) return 'MONTH';
  if (/^\d{4}-\d{2}-\d{2}$/.test(ref)) return 'DAY';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(ref)) return 'HOUR';
  return null;
}

/** annual root reports no per-node sourceLevel/derived (it is the whole-year reduction). */
function stripAggMeta(node: GoalTreeNode): GoalTreeNode {
  return { value: node.value, method: node.method };
}

function mapHistoryRow(row: ConsumptionGoalHistoryRow): GoalHistoryEntry {
  return {
    source: (row.source ?? 'EDIT') as GoalHistorySource,
    actionLevel: row.actionLevel as GoalSourceLevel,
    bucketRef: row.bucketRef,
    oldValue: row.oldValue === null ? null : Number(row.oldValue),
    newValue: row.newValue === null ? null : Number(row.newValue),
    bucketCount: row.bucketCount ?? 1,
    details: Array.isArray(row.details) ? (row.details as GoalHistoryDetail[]) : [],
    distributed: row.distributed,
    hoursAffected: row.hoursAffected,
    version: row.version,
    actor: row.actor,
    changedAt: (row.changedAt instanceof Date ? row.changedAt : new Date(row.changedAt)).toISOString(),
  };
}

export const consumptionGoalService = new ConsumptionGoalService();
