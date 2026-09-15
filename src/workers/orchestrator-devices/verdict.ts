// =============================================================================
// orchestrator-devices — central verdict (pure, no DB/IO)
//
// Maps a probe outcome to the central's proposed status + how its devices should
// be classified when there is no payload to classify from (auth/config/down).
//
// Two-threshold model (RFC-0062 §5): a genuine down does NOT flip the central
// straight to OFFLINE. Measured as (now − last success):
//   < warning window                 ⇒ ONLINE  (a blip within tolerance)
//   [warning window, offline window) ⇒ DEGRADED (WARNING / ATENÇÃO)
//   ≥ offline window                 ⇒ OFFLINE
// Windows come from env: ORCH_DEVICES_CENTRAL_WARNING_MIN (5) and
// ORCH_DEVICES_CENTRAL_OFFLINE_MIN (150). A central that has never succeeded
// (lastSuccessAt = null) is already past both. Only `pastOffline` opens a
// CENTRAL_OFFLINE incident; `pastWarning` is reserved for a future CENTRAL_WARNING.
//
// Kept side-effect-free (types only) so it is unit-testable without a DB.
// =============================================================================

import type { ProbeOutcome } from './gatewayClient';
import type { Classification } from './ladder';

export interface CentralVerdict {
  reachable: boolean;
  genuineDown: boolean; // a real down (not auth/config)
  pastWarning: boolean; // genuine down AND ≥ warning window since last success ⇒ WARNING (DEGRADED)
  pastOffline: boolean; // genuine down AND ≥ offline window since last success ⇒ OFFLINE
  proposedStatus: string;
  probeResult: string;
  deviceFallback: Classification | null;
}

export function centralVerdict(
  outcome: ProbeOutcome,
  current: string,
  lastSuccessAt: Date | null,
  warningMs: number,
  offlineMs: number,
  nowMs: number,
): CentralVerdict {
  if (outcome.ok) {
    return { reachable: true, genuineDown: false, pastWarning: false, pastOffline: false, proposedStatus: 'ONLINE', probeResult: 'OK', deviceFallback: null };
  }
  if (outcome.kind === 'AUTH_ERROR') {
    return { reachable: false, genuineDown: false, pastWarning: false, pastOffline: false, proposedStatus: current, probeResult: 'AUTH_ERROR',
      deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'AUTH_ERROR' } };
  }
  if (outcome.kind === 'CONFIG_ERROR') {
    return { reachable: false, genuineDown: false, pastWarning: false, pastOffline: false, proposedStatus: current, probeResult: 'CONFIG_ERROR',
      deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CONFIG_ERROR' } };
  }
  // Genuine down (timeout / conn refused / 5xx / parse-fail after retries).
  const sinceSuccessMs = lastSuccessAt ? (nowMs - lastSuccessAt.getTime()) : Infinity;
  const pastWarning = sinceSuccessMs >= warningMs;
  const pastOffline = sinceSuccessMs >= offlineMs;
  const proposedStatus = pastOffline ? 'OFFLINE' : pastWarning ? 'DEGRADED' : 'ONLINE';
  return { reachable: false, genuineDown: true, pastWarning, pastOffline, proposedStatus, probeResult: outcome.kind,
    deviceFallback: { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CENTRAL_UNREACHABLE' } };
}

export type TimelineStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';

/**
 * The connectivity state for the durable timeline (orchestrator_devices_status_history).
 * OK ⇒ ONLINE; a genuine down ⇒ ONLINE within the warning window, DEGRADED past it,
 * OFFLINE past the offline window; an INDETERMINATE probe (AUTH_ERROR/CONFIG_ERROR —
 * not reachable, not a genuine down) CARRIES the last known state so it never records
 * a fake transition. With no prior state to carry, it is UNKNOWN. Pure — DB-free.
 */
export function nextTimelineStatus(
  v: Pick<CentralVerdict, 'reachable' | 'genuineDown' | 'pastWarning' | 'pastOffline'>,
  last: string | null,
): TimelineStatus {
  if (v.reachable) return 'ONLINE';
  if (v.genuineDown) return v.pastOffline ? 'OFFLINE' : v.pastWarning ? 'DEGRADED' : 'ONLINE';
  return (last as TimelineStatus) ?? 'UNKNOWN';
}
