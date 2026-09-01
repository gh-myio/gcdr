import { classifyDevice, isDeviceTransition } from '../../../src/workers/orchestrator-devices/ladder';

describe('orchestrator-devices ladder — classifyDevice (RFC-0062 §6)', () => {
  it('row 2: parent central unreachable → UNKNOWN + CENTRAL_UNREACHABLE (cascade)', () => {
    expect(classifyDevice({ centralReachable: false, gatewayStatus: 'online' }))
      .toEqual({ connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CENTRAL_UNREACHABLE' });
  });

  it('row 3: gateway offline → OFFLINE/CRITICAL (authoritative down)', () => {
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'offline' }))
      .toEqual({ connectivity: 'OFFLINE', health: 'CRITICAL', unknownReason: null });
  });

  it('row 3 precedence: offline wins over telemetryStaleHard', () => {
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'offline', telemetryStaleHard: true }).connectivity)
      .toBe('OFFLINE');
  });

  it('row 4: online but telemetry stale-hard → OFFLINE/CRITICAL (frozen meter)', () => {
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'online', telemetryStaleHard: true }))
      .toEqual({ connectivity: 'OFFLINE', health: 'CRITICAL', unknownReason: null });
  });

  it('row 5: gateway bad → ONLINE/DEGRADED', () => {
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'bad' }))
      .toEqual({ connectivity: 'ONLINE', health: 'DEGRADED', unknownReason: null });
  });

  it('row 6: online but soft-stale → ONLINE/DEGRADED', () => {
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'online', telemetryStaleSoft: true }))
      .toEqual({ connectivity: 'ONLINE', health: 'DEGRADED', unknownReason: null });
  });

  it('row 7: online + open alarm → ONLINE/DEGRADED', () => {
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'online', hasOpenAlarm: true }))
      .toEqual({ connectivity: 'ONLINE', health: 'DEGRADED', unknownReason: null });
  });

  it('row 8: online + fresh + no alarm → ONLINE/HEALTHY', () => {
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'online' }))
      .toEqual({ connectivity: 'ONLINE', health: 'HEALTHY', unknownReason: null });
  });

  it('whitelist: an UNKNOWN gateway status never becomes ONLINE', () => {
    for (const weird of ['weird', 'boot', '', 'ONLINE_ISH', 'faulted']) {
      const r = classifyDevice({ centralReachable: true, gatewayStatus: weird });
      expect(r.connectivity).toBe('UNKNOWN');
      expect(r.unknownReason).toBe('SCAN_FAILED');
    }
  });

  it('case-insensitive status matching', () => {
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'ONLINE' }).connectivity).toBe('ONLINE');
    expect(classifyDevice({ centralReachable: true, gatewayStatus: 'OffLine' }).connectivity).toBe('OFFLINE');
  });
});

describe('orchestrator-devices ladder — isDeviceTransition (only-on-change)', () => {
  const current = { connectivityStatus: 'ONLINE', healthStatus: 'HEALTHY', unknownReason: null };

  it('no change → false', () => {
    expect(isDeviceTransition(current, { connectivity: 'ONLINE', health: 'HEALTHY', unknownReason: null })).toBe(false);
  });
  it('connectivity change → true', () => {
    expect(isDeviceTransition(current, { connectivity: 'OFFLINE', health: 'HEALTHY', unknownReason: null })).toBe(true);
  });
  it('health change → true', () => {
    expect(isDeviceTransition(current, { connectivity: 'ONLINE', health: 'DEGRADED', unknownReason: null })).toBe(true);
  });
  it('unknownReason null → value is a transition', () => {
    expect(isDeviceTransition(current, { connectivity: 'UNKNOWN', health: 'UNKNOWN', unknownReason: 'CENTRAL_UNREACHABLE' })).toBe(true);
  });
});
