import { centralVerdict, nextTimelineStatus } from '../../../src/workers/orchestrator-devices/verdict';
import type { ProbeOutcome } from '../../../src/workers/orchestrator-devices/gatewayClient';

// Two thresholds + a fixed "now" so the tests are deterministic.
const WARNING = 5 * 60_000;    // 5 minutes  → DEGRADED starts
const OFFLINE = 150 * 60_000;  // 150 minutes → OFFLINE starts
const NOW = 1_700_000_000_000;
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

const ok: ProbeOutcome = { ok: true, slaves: [], skipped: 0, latencyMs: 12, attempts: 1 };
const timeout: ProbeOutcome = { ok: false, kind: 'TIMEOUT', latencyMs: 5000, attempts: 2, message: 'timeout' };
const connRefused: ProbeOutcome = { ok: false, kind: 'CONN_REFUSED', latencyMs: 30, attempts: 1, message: 'refused' };
const authErr: ProbeOutcome = { ok: false, kind: 'AUTH_ERROR', httpStatus: 401, latencyMs: 20, attempts: 1, message: 'unauthorized' };
const configErr: ProbeOutcome = { ok: false, kind: 'CONFIG_ERROR', httpStatus: 404, latencyMs: 20, attempts: 1, message: 'nxdomain' };

describe('centralVerdict — two-threshold model (ONLINE → DEGRADED → OFFLINE)', () => {
  it('probe OK ⇒ ONLINE (stamps success, not down)', () => {
    const v = centralVerdict(ok, 'OFFLINE', minsAgo(999), WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('ONLINE');
    expect(v.reachable).toBe(true);
    expect(v.genuineDown).toBe(false);
    expect(v.pastWarning).toBe(false);
    expect(v.pastOffline).toBe(false);
  });

  it('genuine down + success WITHIN the warning window (<5min) ⇒ ONLINE (blip tolerated)', () => {
    const v = centralVerdict(timeout, 'ONLINE', minsAgo(1), WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('ONLINE');
    expect(v.genuineDown).toBe(true);
    expect(v.pastWarning).toBe(false);
    expect(v.pastOffline).toBe(false);
  });

  it('genuine down in [warning, offline) ⇒ DEGRADED (WARNING), not yet OFFLINE', () => {
    const v = centralVerdict(timeout, 'ONLINE', minsAgo(10), WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('DEGRADED');
    expect(v.genuineDown).toBe(true);
    expect(v.pastWarning).toBe(true);
    expect(v.pastOffline).toBe(false);
  });

  it('genuine down PAST the offline window (≥150min) ⇒ OFFLINE', () => {
    const v = centralVerdict(timeout, 'ONLINE', minsAgo(200), WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('OFFLINE');
    expect(v.genuineDown).toBe(true);
    expect(v.pastWarning).toBe(true);
    expect(v.pastOffline).toBe(true);
  });

  it('genuine down + NEVER succeeded (null) ⇒ OFFLINE immediately (past both windows)', () => {
    const v = centralVerdict(connRefused, 'ONLINE', null, WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('OFFLINE');
    expect(v.pastWarning).toBe(true);
    expect(v.pastOffline).toBe(true);
  });

  it('warning boundary inclusive: success exactly warningMs ago ⇒ DEGRADED', () => {
    const v = centralVerdict(timeout, 'ONLINE', new Date(NOW - WARNING), WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('DEGRADED');
    expect(v.pastWarning).toBe(true);
    expect(v.pastOffline).toBe(false);
  });

  it('offline boundary inclusive: success exactly offlineMs ago ⇒ OFFLINE', () => {
    const v = centralVerdict(timeout, 'ONLINE', new Date(NOW - OFFLINE), WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('OFFLINE');
    expect(v.pastOffline).toBe(true);
  });

  it('AUTH_ERROR is NOT a genuine down ⇒ keeps current status, never OFFLINE', () => {
    const v = centralVerdict(authErr, 'ONLINE', null, WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('ONLINE'); // = current
    expect(v.genuineDown).toBe(false);
    expect(v.pastWarning).toBe(false);
    expect(v.pastOffline).toBe(false);
    expect(v.probeResult).toBe('AUTH_ERROR');
  });

  it('CONFIG_ERROR is NOT a genuine down ⇒ keeps current status', () => {
    const v = centralVerdict(configErr, 'OFFLINE', minsAgo(999), WARNING, OFFLINE, NOW);
    expect(v.proposedStatus).toBe('OFFLINE'); // = current
    expect(v.genuineDown).toBe(false);
    expect(v.probeResult).toBe('CONFIG_ERROR');
  });
});

describe('nextTimelineStatus — durable timeline state (carries last on indeterminate)', () => {
  it('reachable ⇒ ONLINE', () => {
    expect(nextTimelineStatus({ reachable: true, genuineDown: false, pastWarning: false, pastOffline: false }, 'OFFLINE')).toBe('ONLINE');
  });
  it('genuine down within the warning window ⇒ ONLINE (blip)', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: true, pastWarning: false, pastOffline: false }, 'ONLINE')).toBe('ONLINE');
  });
  it('genuine down in the warning band ⇒ DEGRADED', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: true, pastWarning: true, pastOffline: false }, 'ONLINE')).toBe('DEGRADED');
  });
  it('genuine down past the offline window ⇒ OFFLINE', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: true, pastWarning: true, pastOffline: true }, 'DEGRADED')).toBe('OFFLINE');
  });
  it('indeterminate (auth/config) CARRIES the last known state (no fake transition)', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: false, pastWarning: false, pastOffline: false }, 'ONLINE')).toBe('ONLINE');
    expect(nextTimelineStatus({ reachable: false, genuineDown: false, pastWarning: false, pastOffline: false }, 'OFFLINE')).toBe('OFFLINE');
  });
  it('indeterminate with no prior state ⇒ UNKNOWN', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: false, pastWarning: false, pastOffline: false }, null)).toBe('UNKNOWN');
  });
});
