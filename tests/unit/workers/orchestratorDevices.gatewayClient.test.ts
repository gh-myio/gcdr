import { probeGateway, type RetryPolicy } from '../../../src/workers/orchestrator-devices/gatewayClient';

const strict: RetryPolicy = { name: 'strict', attempts: [{ delay_ms: 0 }] };
const threeFast: RetryPolicy = { name: 'default', attempts: [{ delay_ms: 0 }, { delay_ms: 0 }, { delay_ms: 0 }] };
const opts = { timeoutMs: 1000, maxTotalMs: 5000 };

// Flat view of the ProbeOutcome union so assertions are unconditional (no narrowing `if`).
type Flat = { ok: boolean; kind?: string; attempts: number; slaves?: unknown[]; skipped?: number };
const flat = (o: unknown): Flat => o as Flat;

describe('gatewayClient — probe classification (RFC-0062 §5)', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => { fetchMock = jest.fn(); global.fetch = fetchMock as unknown as typeof fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('2xx + valid slaves array → ok, tolerant (bad rows skipped+counted)', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => [{ id: 1, status: 'online' }, { nope: true }] });
    const r = flat(await probeGateway('http://gw', strict, opts));
    expect(r.ok).toBe(true);
    expect(r.slaves).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });

  it('2xx + non-array body → PARSE_FAIL (a 200+HTML proxy is not healthy)', async () => {
    fetchMock.mockResolvedValue({ status: 200, ok: true, json: async () => ({ not: 'an array' }) });
    const r = flat(await probeGateway('http://gw', strict, opts));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('PARSE_FAIL');
  });

  it('401 → AUTH_ERROR and is NOT retried', async () => {
    fetchMock.mockResolvedValue({ status: 401, ok: false });
    const r = flat(await probeGateway('http://gw', threeFast, opts));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('AUTH_ERROR');
    expect(r.attempts).toBe(1);
  });

  it('404 → CONFIG_ERROR and is NOT retried (deterministic, not a down verdict)', async () => {
    fetchMock.mockResolvedValue({ status: 404, ok: false });
    const r = flat(await probeGateway('http://gw', threeFast, opts));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('CONFIG_ERROR');
    expect(r.attempts).toBe(1);
  });

  it('500 → HTTP_5XX and IS retried under the policy', async () => {
    fetchMock.mockResolvedValue({ status: 500, ok: false });
    const r = flat(await probeGateway('http://gw', threeFast, opts));
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('HTTP_5XX');
    expect(r.attempts).toBe(3);
  });

  it('a 2xx on a later attempt wins over an earlier 500', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 500, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => [{ id: 9, status: 'online' }] });
    const r = flat(await probeGateway('http://gw', threeFast, opts));
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
  });
});
