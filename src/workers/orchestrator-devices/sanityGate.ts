// =============================================================================
// orchestrator-devices — sanity gate / mass-transition circuit breaker (§7)
//
// A firmware bug, a proxy fault, or a tunnel outage can make a large slice of the
// fleet report down at once. This gate sits in FRONT of any canonical write: if
// more than `maxPct` of the in-scope entities would flip to OFFLINE/CRITICAL in
// a single scan, it HOLDS the canonical write, preserves last-known, and raises
// a loud anomaly. It NEVER silently swallows a real outage — held, not dropped.
//
// It is fleet-level: a single central legitimately taking all its slaves offline
// is expected (cascade suppression turns those devices into UNKNOWN, not OFFLINE,
// so they never count as flips here). This only trips when the fleet as a whole
// flips implausibly.
// =============================================================================

export interface SanityInput {
  /** entities considered this scan (e.g. centrals probed, or devices classified). */
  totalInScope: number;
  /** how many would transition INTO OFFLINE/CRITICAL this scan. */
  flippingToDown: number;
  /** threshold percentage (FLAGS.sanity_max_fleet_flip_pct, default 30). */
  maxPct: number;
}

export interface SanityResult {
  allowed: boolean; // canonical writes may proceed
  held: boolean; // writes held pending human review
  flippedPct: number;
  reason?: string;
}

export function evaluateSanityGate(input: SanityInput): SanityResult {
  if (input.totalInScope <= 0 || input.flippingToDown <= 0) {
    return { allowed: true, held: false, flippedPct: 0 };
  }
  const flippedPct = (input.flippingToDown / input.totalInScope) * 100;
  if (flippedPct > input.maxPct) {
    return {
      allowed: false,
      held: true,
      flippedPct,
      reason: `mass transition ${flippedPct.toFixed(1)}% of ${input.totalInScope} > ${input.maxPct}% — held for review`,
    };
  }
  return { allowed: true, held: false, flippedPct };
}
