import {
  dedupeKey,
  buildCandidatePayload,
  debounceSatisfied,
  emitCandidate,
  isCentralDownState,
  isDeviceDownState,
  type DownCandidate,
  type EmitConfig,
} from '../../../src/workers/orchestrator-devices/incidents';

const central: DownCandidate = { kind: 'CENTRAL_OFFLINE', entityType: 'central', entityId: 'cen1', tenantId: 't1', customerId: 'cust1', centralId: 'cen1', causingSignal: 'probe:TIMEOUT' };
const device: DownCandidate = { kind: 'DEVICE_OFFLINE', entityType: 'device', entityId: 'dev1', tenantId: 't1', customerId: 'cust1', centralId: 'cen1', causingSignal: 'gateway:offline' };

describe('incidents — dedupe key (RFC-0062 §8, omits day)', () => {
  it('central key: tenant:customer:central:id:kind (no day)', () => {
    expect(dedupeKey(central)).toBe('t1:cust1:central:cen1:CENTRAL_OFFLINE');
    expect(dedupeKey(central)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it('device key: tenant:customer:device:id:kind (no day)', () => {
    expect(dedupeKey(device)).toBe('t1:cust1:device:dev1:DEVICE_OFFLINE');
  });
});

describe('incidents — payload builder (RFC-0031)', () => {
  it('central → CRITICAL, mode PARTIAL, source set, no deviceId', () => {
    const p = buildCandidatePayload(central, '2026-09-01T00:00:00.000Z');
    expect(p).toMatchObject({ kind: 'CENTRAL_OFFLINE', severity: 'CRITICAL', mode: 'PARTIAL', source: 'gcdr-orchestrator-devices', status: 'OPEN', tenantId: 't1', customerId: 'cust1', centralId: 'cen1' });
    expect(p.deviceId).toBeUndefined();
    expect(p.evidence.causingSignal).toBe('probe:TIMEOUT');
  });
  it('device → HIGH and carries deviceId', () => {
    const p = buildCandidatePayload(device, '2026-09-01T00:00:00.000Z');
    expect(p.severity).toBe('HIGH');
    expect(p.deviceId).toBe('dev1');
  });
});

describe('incidents — debounce (only after N consecutive down; first bad tick never opens)', () => {
  it('insufficient history → false', () => {
    expect(debounceSatisfied(['OFFLINE'], isCentralDownState, 2)).toBe(false);
    expect(debounceSatisfied([], isCentralDownState, 1)).toBe(false);
  });
  it('N consecutive down → true', () => {
    expect(debounceSatisfied(['OFFLINE', 'OFFLINE'], isCentralDownState, 2)).toBe(true);
  });
  it('a non-down within the window → false', () => {
    expect(debounceSatisfied(['OFFLINE', 'ONLINE', 'OFFLINE'], isCentralDownState, 2)).toBe(false);
  });
  it('device down matcher accepts OFFLINE/<health>', () => {
    expect(isDeviceDownState('OFFLINE/CRITICAL')).toBe(true);
    expect(isDeviceDownState('ONLINE/HEALTHY')).toBe(false);
    expect(debounceSatisfied(['OFFLINE/CRITICAL', 'OFFLINE/CRITICAL'], isDeviceDownState, 2)).toBe(true);
  });
  it('requiredTicks < 1 → false (guard)', () => {
    expect(debounceSatisfied(['OFFLINE'], isCentralDownState, 0)).toBe(false);
  });
});

describe('incidents — emitCandidate (flag gate, dry-run, never throws, no token in logs)', () => {
  const payload = buildCandidatePayload(central, '2026-09-01T00:00:00.000Z');
  const TOKEN = 'super-secret-token-value';
  let logs: Array<{ level: string; msg: string; extra?: Record<string, unknown> }>;
  const log = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => logs.push({ level, msg, extra });

  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => { logs = []; fetchMock = jest.fn(); global.fetch = fetchMock as unknown as typeof fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('emission disabled → "disabled", no fetch', async () => {
    const cfg: EmitConfig = { emissionEnabled: false, apiUrl: 'https://alarms', apiToken: TOKEN };
    expect(await emitCandidate(payload, cfg, log)).toBe('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no ALARMS_API_URL → "dry-run", no fetch', async () => {
    const cfg: EmitConfig = { emissionEnabled: true, apiUrl: undefined, apiToken: TOKEN };
    expect(await emitCandidate(payload, cfg, log)).toBe('dry-run');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enabled + URL + 2xx → "posted"', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202 });
    const cfg: EmitConfig = { emissionEnabled: true, apiUrl: 'https://alarms/', apiToken: TOKEN };
    expect(await emitCandidate(payload, cfg, log)).toBe('posted');
    expect(fetchMock).toHaveBeenCalledWith('https://alarms/incidents/candidates', expect.objectContaining({ method: 'POST' }));
  });

  it('authenticates via X-API-Key (ALARMS ingestion), not Authorization/Bearer', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202 });
    const cfg: EmitConfig = { emissionEnabled: true, apiUrl: 'https://alarms', apiToken: TOKEN };
    await emitCandidate(payload, cfg, log);
    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers['x-api-key']).toBe(TOKEN);
    expect(headers.authorization).toBeUndefined();
  });

  it('non-2xx → "failed" (does not throw)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const cfg: EmitConfig = { emissionEnabled: true, apiUrl: 'https://alarms', apiToken: TOKEN };
    expect(await emitCandidate(payload, cfg, log)).toBe('failed');
  });

  it('fetch rejects → "failed" and NEVER throws (sweep must not fail)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const cfg: EmitConfig = { emissionEnabled: true, apiUrl: 'https://alarms', apiToken: TOKEN };
    await expect(emitCandidate(payload, cfg, log)).resolves.toBe('failed');
  });

  it('the ALARMS token is NEVER written to logs', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const cfg: EmitConfig = { emissionEnabled: true, apiUrl: 'https://alarms', apiToken: TOKEN };
    await emitCandidate(payload, cfg, log);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
  });
});
