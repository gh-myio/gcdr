// =============================================================================
// RFC-0046: Customer Consumption Goals — response contracts (TypeScript types)
//
// The read wire shape returns the goal tree at the requested granularity,
// derived from the canonical hourly grain, plus the optimistic `version`.
// Each derived node declares its `method` so a temperature weighted-average is
// never mistaken for a sum. This file defines ONLY response-side types — no
// business logic.
// =============================================================================

import type {
  GoalDomain,
  GoalGranularity,
  GoalSourceLevel,
  GoalAggregationMethod,
} from '../request/GoalsDTO';

// -----------------------------------------------------------------------------
// Derived tree nodes
//
// Every derived node carries:
//   - value:       the rolled-up (or distributed) target at this node
//   - method:      how children were reduced into this value (SUM | AVERAGE)
//   - sourceLevel: the level the operator actually set for this bucket
//   - derived:     true when the value was system-distributed/aggregated,
//                  false when the operator set this exact bucket
//
// `annual` may legitimately have no `sourceLevel`/`derived` when nothing was set
// at the year level itself (it was rolled up from finer buckets); those fields
// are therefore optional on the annual node and required on leaf-set buckets.
// -----------------------------------------------------------------------------

/** A single derived tree node (the {value, method, sourceLevel, derived} leaf). */
export interface GoalTreeNode {
  value: number;
  method: GoalAggregationMethod;
  sourceLevel: GoalSourceLevel;
  derived: boolean;
}

/** Annual node: source metadata is optional (it may be a pure roll-up). */
export interface GoalAnnualNode {
  value: number;
  method: GoalAggregationMethod;
  sourceLevel?: GoalSourceLevel;
  derived?: boolean;
}

/** Map of hour key ("00".."23") → hour node. Present at `granularity=hour`. */
export type GoalHourMap = Record<string, GoalTreeNode>;

/** Day node: optional nested hourly map when the hour granularity is requested. */
export interface GoalDayNode extends GoalTreeNode {
  hourly?: GoalHourMap;
}

/** Map of day key ("01".."31") → day node. */
export type GoalDayMap = Record<string, GoalDayNode>;

/** Month node: optional nested daily map at `granularity=day` or finer. */
export interface GoalMonthNode extends GoalTreeNode {
  daily?: GoalDayMap;
}

/** Map of month key ("01".."12") → month node. */
export type GoalMonthMap = Record<string, GoalMonthNode>;

/**
 * The derived tree. Which fields are populated depends on the requested
 * granularity:
 *   - year:  { annual }
 *   - month: { annual, monthly }
 *   - day:   { annual, monthly: { ..daily } }
 *   - hour:  { annual, monthly: { ..daily: { ..hourly } } }
 */
export interface GoalTree {
  annual: GoalAnnualNode;
  monthly?: GoalMonthMap;
}

// -----------------------------------------------------------------------------
// History entry
//
// One row per change, recording the level the user acted on and how the system
// distributed it. Mirrors `consumption_goal_history`. `?fetchHistory=true`
// returns ≤100 of these, newest first.
// -----------------------------------------------------------------------------

export interface GoalHistoryEntry {
  /** Level the user touched (YEAR | MONTH | DAY | HOUR). */
  actionLevel: GoalSourceLevel;
  /** Bucket reference: "2026" | "2026-03" | "2026-03-15" | "2026-03-15T08". */
  bucketRef: string;
  /** Value at the input level before the change (null on create). */
  oldValue: number | null;
  /** Value at the input level after the change (null on delete). */
  newValue: number | null;
  /** True when the system spread the change down to hour rows. */
  distributed: boolean;
  /** Count of hour rows written by this change. */
  hoursAffected: number;
  /** The version this change produced. */
  version: number;
  /** ISO-8601 timestamp of the change. */
  changedAt: string;
  /** Who changed it (user/actor id), or null for system changes. */
  actor: string | null;
}

// -----------------------------------------------------------------------------
// Top-level GET response
//
// GET /customers/:id/goals?domain=&year=&granularity=&fetchHistory=
// -----------------------------------------------------------------------------

export interface GetGoalsResponseDTO {
  customerId: string;
  domain: GoalDomain;
  /** Unit from domain config: kWh | m3 | C. */
  unit: string;
  aggregationMethod: GoalAggregationMethod;
  year: number;
  /** Optimistic concurrency version for this (customer, domain, year). */
  version: number;
  /** Granularity the tree was derived at (echoes the request, default month). */
  granularity: GoalGranularity;
  /** The derived tree at the requested granularity. */
  tree: GoalTree;
  /** Present only when fetchHistory=true; ≤100 entries, newest first. */
  history?: GoalHistoryEntry[];
}

// -----------------------------------------------------------------------------
// GET /customers/:id/goals (no domain) — summary listing
// -----------------------------------------------------------------------------

/** One summary entry per domain that has goals for the customer. */
export interface GoalDomainSummaryDTO {
  domain: GoalDomain;
  unit: string;
  aggregationMethod: GoalAggregationMethod;
  /** Years that have at least one goal bucket for this domain. */
  years: number[];
  /** Latest version across the listed years (highest), for quick display. */
  version: number;
}

export interface ListGoalsSummaryResponseDTO {
  customerId: string;
  domains: GoalDomainSummaryDTO[];
}

// -----------------------------------------------------------------------------
// Write responses (PUT / PATCH / DELETE)
//
// Return the new version and a compact summary of what the write did, so the
// front-end can reconcile without an extra round-trip.
// -----------------------------------------------------------------------------

export interface GoalsWriteResponseDTO {
  customerId: string;
  domain: GoalDomain;
  year: number;
  /** New optimistic version after the write. */
  version: number;
  /** Count of hour rows written/affected by this write. */
  hoursAffected: number;
  /** The level the operator acted on for the audit event. */
  actionLevel: GoalSourceLevel;
}

// -----------------------------------------------------------------------------
// CSV import (dry-run preview + confirm)
// -----------------------------------------------------------------------------

/** A single line-level diagnostic from a CSV import dry-run. */
export interface GoalImportLineDiagnostic {
  /** 1-based source line number in the uploaded CSV. */
  line: number;
  status: 'OK' | 'ERROR';
  /** Present when status = ERROR; human-readable reason. */
  message?: string;
  /** Resolved bucket reference for an OK line (e.g. "2026-03-15"). */
  bucketRef?: string;
}

export interface ImportGoalsResponseDTO {
  customerId: string;
  domain: GoalDomain;
  year: number;
  /** True when this was a preview (nothing persisted). */
  dryRun: boolean;
  okCount: number;
  errorCount: number;
  /** Line-by-line diagnostics (errors always listed; OK lines may be summarised). */
  diagnostics: GoalImportLineDiagnostic[];
  /** The ghost tree showing how the year would look (preview) or now looks. */
  tree: GoalTree;
  /** New version when persisted (dryRun=false); omitted on a pure preview. */
  version?: number;
}
