import {
  shouldApplyCanonical,
  planCanonicalWrites,
  type Transition,
} from '../../../src/workers/orchestrator-devices/canonicalApply';
import type { OrchestratorFlags } from '../../../src/workers/orchestrator-devices/control';

function flags(over: Partial<OrchestratorFlags> = {}): OrchestratorFlags {
  return { shadowMode: false, canonicalWritesEnabled: true, incidentEmissionEnabled: false, sanityMaxFleetFlipPct: 30, incidentOpenAfterTicks: 2, ...over };
}

function centralT(id: string, to: string): Transition {
  return { entityType: 'central', entityId: id, tenantId: 't1', centralId: id, oldValues: { connectionStatus: 'ONLINE' }, newValues: { connectionStatus: to }, cascade: false, causingSignal: 'probe:TIMEOUT' };
}
function deviceT(id: string, centralId: string, conn: string, health: string, reason: string | null, cascade = false): Transition {
  return { entityType: 'device', entityId: id, tenantId: 't1', centralId, oldValues: { connectivityStatus: 'ONLINE', healthStatus: 'HEALTHY', unknownReason: null }, newValues: { connectivityStatus: conn, healthStatus: health, unknownReason: reason }, cascade, causingSignal: 'gateway:offline' };
}

describe('shouldApplyCanonical — the three guards (RFC-0062 item 7)', () => {
  it('all guards satisfied → true', () => {
    expect(shouldApplyCanonical(flags(), false)).toBe(true);
  });
  it('blocked by shadow_mode', () => {
    expect(shouldApplyCanonical(flags({ shadowMode: true }), false)).toBe(false);
  });
  it('blocked by canonical_writes_enabled=false', () => {
    expect(shouldApplyCanonical(flags({ canonicalWritesEnabled: false }), false)).toBe(false);
  });
  it('blocked by sanity gate held', () => {
    expect(shouldApplyCanonical(flags(), true)).toBe(false);
  });
  it('rollback via flag: flipping shadow_mode back on disables apply', () => {
    expect(shouldApplyCanonical(flags(), false)).toBe(true);
    expect(shouldApplyCanonical(flags({ shadowMode: true }), false)).toBe(false);
    expect(shouldApplyCanonical(flags({ canonicalWritesEnabled: false }), false)).toBe(false);
  });
});

describe('planCanonicalWrites — batching + audit-only-on-transition', () => {
  it('empty transitions → empty plan (only-on-change: nothing to write)', () => {
    const plan = planCanonicalWrites([]);
    expect(plan.centralUpdates).toEqual([]);
    expect(plan.deviceUpdates).toEqual([]);
    expect(plan.auditRows).toEqual([]);
  });

  it('central + non-cascade device → both updated and both audited', () => {
    const plan = planCanonicalWrites([centralT('c1', 'OFFLINE'), deviceT('d1', 'c1', 'OFFLINE', 'CRITICAL', null)]);
    expect(plan.centralUpdates).toEqual([{ connectionStatus: 'OFFLINE', ids: ['c1'] }]);
    expect(plan.deviceUpdates).toHaveLength(1);
    expect(plan.deviceUpdates[0].ids).toEqual(['d1']);
    expect(plan.auditRows).toHaveLength(2);
    const events = plan.auditRows.map((a) => a.eventType).sort();
    expect(events).toEqual(['CENTRAL_CONNECTION_STATUS_CHANGED', 'DEVICE_CONNECTIVITY_STATUS_CHANGED']);
  });

  it('cascade device transitions are NOT individually audited; central carries the count', () => {
    const plan = planCanonicalWrites([
      centralT('c1', 'OFFLINE'),
      deviceT('d1', 'c1', 'UNKNOWN', 'UNKNOWN', 'CENTRAL_UNREACHABLE', true),
      deviceT('d2', 'c1', 'UNKNOWN', 'UNKNOWN', 'CENTRAL_UNREACHABLE', true),
    ]);
    // devices still get written (state must reflect reality)...
    expect(plan.deviceUpdates).toHaveLength(1);
    expect(plan.deviceUpdates[0].ids.sort()).toEqual(['d1', 'd2']);
    // ...but only the central is audited (cascade suppression), with the count.
    expect(plan.auditRows).toHaveLength(1);
    expect(plan.auditRows[0].eventType).toBe('CENTRAL_CONNECTION_STATUS_CHANGED');
    expect((plan.auditRows[0].metadata as { cascadeDevices?: number }).cascadeDevices).toBe(2);
  });

  it('devices with the same target triple are grouped into one update', () => {
    const plan = planCanonicalWrites([
      deviceT('d1', 'c1', 'OFFLINE', 'CRITICAL', null),
      deviceT('d2', 'c1', 'OFFLINE', 'CRITICAL', null),
      deviceT('d3', 'c1', 'ONLINE', 'DEGRADED', null),
    ]);
    expect(plan.deviceUpdates).toHaveLength(2);
    const offline = plan.deviceUpdates.find((u) => u.connectivityStatus === 'OFFLINE');
    expect(offline?.ids.sort()).toEqual(['d1', 'd2']);
  });

  it('computes connectivity edges for last(Dis)connectedAt (edges, not target match)', () => {
    const reconnect: Transition = { entityType: 'device', entityId: 'd1', tenantId: 't1', centralId: 'c1',
      oldValues: { connectivityStatus: 'OFFLINE', healthStatus: 'CRITICAL', unknownReason: null },
      newValues: { connectivityStatus: 'ONLINE', healthStatus: 'HEALTHY', unknownReason: null }, cascade: false, causingSignal: 'gateway:online' };
    const disconnect = deviceT('d2', 'c1', 'OFFLINE', 'CRITICAL', null); // old ONLINE → OFFLINE
    const healthOnly: Transition = { entityType: 'device', entityId: 'd3', tenantId: 't1', centralId: 'c1',
      oldValues: { connectivityStatus: 'ONLINE', healthStatus: 'HEALTHY', unknownReason: null },
      newValues: { connectivityStatus: 'ONLINE', healthStatus: 'DEGRADED', unknownReason: null }, cascade: false, causingSignal: 'gateway:bad' };
    const plan = planCanonicalWrites([reconnect, disconnect, healthOnly]);
    expect(plan.deviceConnectedIds).toEqual(['d1']);
    expect(plan.deviceDisconnectedIds).toEqual(['d2']);
    // a health-only change within ONLINE is in NEITHER edge list (no re-stamp)
    expect(plan.deviceConnectedIds).not.toContain('d3');
    expect(plan.deviceDisconnectedIds).not.toContain('d3');
  });

  it('audit carries actor SYSTEM and old/new values', () => {
    const plan = planCanonicalWrites([centralT('c1', 'OFFLINE')]);
    const row = plan.auditRows[0];
    expect(row.actorType).toBe('SYSTEM');
    expect(row.oldValues).toEqual({ connectionStatus: 'ONLINE' });
    expect(row.newValues).toEqual({ connectionStatus: 'OFFLINE' });
  });
});
