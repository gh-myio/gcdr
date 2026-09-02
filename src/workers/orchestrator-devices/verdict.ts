// =============================================================================
// orchestrator-devices — central verdict (pure, no DB/IO)
//
// Maps a probe outcome to the central's proposed status + how its devices should
// be classified when there is no payload to classify from (auth/config/down).
//
// Grace window (RFC-0062 §5): a genuine down does NOT flip the central straight to
// OFFLINE. It is held in DEGRADED (warning) until there has been NO successful sync
// for `graceMs` (ORCH_DEVICES_OFFLINE_GRACE_MIN), then proposed OFFLINE. A central
// that has never succeeded (lastSuccessAt = null) is already past grace.
//
// Kept side-effect-free (types only) so it is unit-testable without a DB.
// =============================================================================

import type { ProbeOutcome } from './gatewayClient';
import type { Classification } from './ladder';

export interface CentralVerdict {
  reachable: boolean;
  genuineDown: boolean; // a real down (not auth/config)
  pastGrace: boolean;   // genuine down AND no success within the grace window ⇒ OFFLINE
  proposedStatus: string;
  probeResult: string;
  deviceFallback: Classification | null;
}

export function centralVerdict(
  outcome: ProbeOutcome,
  current: string,
  lastSuccessAt: Date | null,
  graceMs: number,
  nowMs: number,
): CentralVerdict {
  if (outcome.ok) {
    return { reachable: true, genuineDown: false, pastGrace: false, proposedStatus: 'ONLINE', probeResult: 'OK', deviceFallback: null };
  }
  if (outcome.kind === 'AUTH_ERROR') {
    return { reachable: false, genuineDown: false, pastGrace: false, proposedStatus: current, probeResult: 'AUTH_ERROR',
      deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'AUTH_ERROR' } };
  }
  if (outcome.kind === 'CONFIG_ERROR') {
    return { reachable: false, genuineDown: false, pastGrace: false, proposedStatus: current, probeResult: 'CONFIG_ERROR',
      deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CONFIG_ERROR' } };
  }
  // Genuine down (timeout / conn refused / 5xx / parse-fail after retries).
  const sinceSuccessMs = lastSuccessAt ? (nowMs - lastSuccessAt.getTime()) : Infinity;
  const pastGrace = sinceSuccessMs >= graceMs;
  return { reachable: false, genuineDown: true, pastGrace, proposedStatus: pastGrace ? 'OFFLINE' : 'DEGRADED', probeResult: outcome.kind,
    deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CENTRAL_UNREACHABLE' } };
}
