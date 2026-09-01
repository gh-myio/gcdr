// =============================================================================
// orchestrator-devices — deterministic connectivity/health ladder (RFC-0062 §6)
//
// A pure, first-match-wins precedence function. This is the source of truth AND
// the test fixture (one case per row). Phase-1 rows need no telemetry; the two
// telemetry rows (4, 6) are gated behind optional inputs for Phase 2.
//
// Whitelist good states, don't blacklist bad ones: ONLINE is granted ONLY for
// gateway status 'online' (and, Phase 2, fresh); an unknown status value is
// never treated as online (§5) — it falls to UNKNOWN, never falsely green.
// =============================================================================

export type Connectivity = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
export type Health = 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'UNKNOWN';
export type UnknownReason =
  | 'AWAITING_FIRST_SCAN'
  | 'NEVER_OBSERVED'
  | 'SCAN_FAILED'
  | 'CENTRAL_UNREACHABLE'
  | 'AUTH_ERROR'
  | 'CONFIG_ERROR';

export interface ClassifyInput {
  /** false ⇒ parent central OFFLINE ⇒ device unobservable (cascade, row 2). */
  centralReachable: boolean;
  /** raw per-slave status from /v2/slaves: 'online' | 'offline' | 'bad' | (unknown). */
  gatewayStatus?: string;
  /** Phase 1 may omit; row 7. */
  hasOpenAlarm?: boolean;
  /** Phase 2 (row 4): no telemetry past the hard limit. */
  telemetryStaleHard?: boolean;
  /** Phase 2 (row 6): telemetry in the soft-stale band. */
  telemetryStaleSoft?: boolean;
}

export interface Classification {
  connectivity: Connectivity;
  health: Health;
  unknownReason: UnknownReason | null;
}

/** RFC-0062 §6 ladder, evaluated top-down, first match wins. */
export function classifyDevice(input: ClassifyInput): Classification {
  // Row 2: parent central unreachable ⇒ unobservable (cascade suppression, §8).
  if (!input.centralReachable) {
    return { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CENTRAL_UNREACHABLE' };
  }

  const status = (input.gatewayStatus ?? '').toLowerCase();

  // Row 3: gateway declares 'offline' ⇒ authoritative down (no freshness needed).
  if (status === 'offline') {
    return { connectivity: 'OFFLINE', health: 'CRITICAL', unknownReason: null };
  }

  // Row 4 (Phase 2): telemetry stale past the HARD limit ⇒ OFFLINE even if the
  // gateway said 'online' — a frozen meter reporting online is not healthy.
  if (input.telemetryStaleHard) {
    return { connectivity: 'OFFLINE', health: 'CRITICAL', unknownReason: null };
  }

  // Whitelist: only 'online'/'bad' are candidates. Any other (unknown vocabulary)
  // is NOT online — a new firmware failure code can never masquerade as healthy.
  if (status !== 'online' && status !== 'bad') {
    return { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'SCAN_FAILED' };
  }

  // Row 5: gateway self-flags 'bad' (reporting, but unhealthy).
  if (status === 'bad') {
    return { connectivity: 'ONLINE', health: 'DEGRADED', unknownReason: null };
  }

  // Row 6 (Phase 2): online but soft-stale ⇒ DEGRADED (not yet OFFLINE).
  if (input.telemetryStaleSoft) {
    return { connectivity: 'ONLINE', health: 'DEGRADED', unknownReason: null };
  }

  // Row 7: open alarm / active no-consumption incident ⇒ DEGRADED.
  if (input.hasOpenAlarm) {
    return { connectivity: 'ONLINE', health: 'DEGRADED', unknownReason: null };
  }

  // Row 8: online + fresh + no alarms ⇒ HEALTHY.
  return { connectivity: 'ONLINE', health: 'HEALTHY', unknownReason: null };
}
