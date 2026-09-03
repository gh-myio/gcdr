import { centralVerdict, nextTimelineStatus } from '../../../src/workers/orchestrator-devices/verdict';
import type { ProbeOutcome } from '../../../src/workers/orchestrator-devices/gatewayClient';

// Grace window + a fixed "now" so the tests are deterministic.
const GRACE = 5 * 60_000; // 5 minutes
const NOW = 1_700_000_000_000;
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

const ok: ProbeOutcome = { ok: true, slaves: [], skipped: 0, latencyMs: 12, attempts: 1 };
const timeout: ProbeOutcome = { ok: false, kind: 'TIMEOUT', latencyMs: 5000, attempts: 2, message: 'timeout' };
const connRefused: ProbeOutcome = { ok: false, kind: 'CONN_REFUSED', latencyMs: 30, attempts: 1, message: 'refused' };
const authErr: ProbeOutcome = { ok: false, kind: 'AUTH_ERROR', httpStatus: 401, latencyMs: 20, attempts: 1, message: 'unauthorized' };
const configErr: ProbeOutcome = { ok: false, kind: 'CONFIG_ERROR', httpStatus: 404, latencyMs: 20, attempts: 1, message: 'nxdomain' };

describe('centralVerdict — grace window (DEGRADED → OFFLINE)', () => {
  it('probe OK ⇒ ONLINE (stamps success, not down)', () => {
    const v = centralVerdict(ok, 'OFFLINE', minsAgo(999), GRACE, NOW);
    expect(v.proposedStatus).toBe('ONLINE');
    expect(v.reachable).toBe(true);
    expect(v.genuineDown).toBe(false);
    expect(v.pastGrace).toBe(false);
  });

  it('genuine down + RECENT success (within grace) ⇒ DEGRADED, not past grace', () => {
    const v = centralVerdict(timeout, 'ONLINE', minsAgo(1), GRACE, NOW);
    expect(v.proposedStatus).toBe('DEGRADED');
    expect(v.genuineDown).toBe(true);
    expect(v.pastGrace).toBe(false);
  });

  it('genuine down + OLD success (>= grace) ⇒ OFFLINE, past grace', () => {
    const v = centralVerdict(timeout, 'ONLINE', minsAgo(10), GRACE, NOW);
    expect(v.proposedStatus).toBe('OFFLINE');
    expect(v.genuineDown).toBe(true);
    expect(v.pastGrace).toBe(true);
  });

  it('genuine down + NEVER succeeded (null) ⇒ OFFLINE immediately (already past grace)', () => {
    const v = centralVerdict(connRefused, 'ONLINE', null, GRACE, NOW);
    expect(v.proposedStatus).toBe('OFFLINE');
    expect(v.pastGrace).toBe(true);
  });

  it('grace boundary is inclusive: success exactly graceMs ago ⇒ OFFLINE', () => {
    const v = centralVerdict(timeout, 'ONLINE', new Date(NOW - GRACE), GRACE, NOW);
    expect(v.proposedStatus).toBe('OFFLINE');
    expect(v.pastGrace).toBe(true);
  });

  it('AUTH_ERROR is NOT a genuine down ⇒ keeps current status, never OFFLINE by grace', () => {
    const v = centralVerdict(authErr, 'ONLINE', null, GRACE, NOW);
    expect(v.proposedStatus).toBe('ONLINE'); // = current
    expect(v.genuineDown).toBe(false);
    expect(v.pastGrace).toBe(false);
    expect(v.probeResult).toBe('AUTH_ERROR');
  });

  it('CONFIG_ERROR is NOT a genuine down ⇒ keeps current status', () => {
    const v = centralVerdict(configErr, 'OFFLINE', minsAgo(999), GRACE, NOW);
    expect(v.proposedStatus).toBe('OFFLINE'); // = current
    expect(v.genuineDown).toBe(false);
    expect(v.probeResult).toBe('CONFIG_ERROR');
  });
});

describe('nextTimelineStatus — durable timeline state (carries last on indeterminate)', () => {
  it('reachable ⇒ ONLINE', () => {
    expect(nextTimelineStatus({ reachable: true, genuineDown: false, pastGrace: false }, 'OFFLINE')).toBe('ONLINE');
  });
  it('genuine down within grace ⇒ DEGRADED', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: true, pastGrace: false }, 'ONLINE')).toBe('DEGRADED');
  });
  it('genuine down past grace ⇒ OFFLINE', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: true, pastGrace: true }, 'DEGRADED')).toBe('OFFLINE');
  });
  it('indeterminate (auth/config) CARRIES the last known state (no fake transition)', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: false, pastGrace: false }, 'ONLINE')).toBe('ONLINE');
    expect(nextTimelineStatus({ reachable: false, genuineDown: false, pastGrace: false }, 'OFFLINE')).toBe('OFFLINE');
  });
  it('indeterminate with no prior state ⇒ UNKNOWN', () => {
    expect(nextTimelineStatus({ reachable: false, genuineDown: false, pastGrace: false }, null)).toBe('UNKNOWN');
  });
});
