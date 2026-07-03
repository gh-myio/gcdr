/**
 * RFC-0050 — Integrations Proxy unit tests (phase B2 quality gate).
 *
 * Covers the test bar set in the RFC's Agent Feedback section:
 * - allowlist: deny-by-default, traversal/encoding negatives, method mismatch
 * - token cache: expiry margin, single-flight, 401 → invalidate + retry once
 * - header hygiene: inbound credentials never forwarded; no secrets logged
 * - config: fail fast on missing env, no fallback
 */
import {
  IntegrationsProxyService,
  IngestionTokenCache,
  isPathAllowed,
  normalizeProxyPath,
  getTargetConfig,
} from '../../../src/services/IntegrationsProxyService';
import { AppError } from '../../../src/shared/errors/AppError';

const ENV_KEYS = [
  'INGESTION_API_BASE_URL',
  'INGESTION_AUTH_URL',
  'INGESTION_CLIENT_ID',
  'INGESTION_CLIENT_SECRET',
  'THINGSBOARD_BASE_URL',
  'PROVISIONING_BASE_URL',
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.INGESTION_API_BASE_URL = 'https://ingestion.test/api/v1/management';
  process.env.INGESTION_AUTH_URL = 'https://ingestion.test/api/v1/auth';
  process.env.INGESTION_CLIENT_ID = 'client-id';
  process.env.INGESTION_CLIENT_SECRET = 'client-secret';
  process.env.THINGSBOARD_BASE_URL = 'https://tb.test';
  process.env.PROVISIONING_BASE_URL = 'https://central.test';
  jest.restoreAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  jest.useRealTimers();
});

function mockFetchOnce(status: number, body: unknown, contentType = 'application/json'): jest.Mock {
  const fn = jest.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': contentType },
    })
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function tokenResponse(token = 'tok-1', expiresIn = 3600): Response {
  return new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: expiresIn }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// =============================================================================
// Allowlist (deny-by-default, data table)
// =============================================================================

describe('isPathAllowed', () => {
  it.each([
    ['ingestion', 'GET', '/customers'],
    ['ingestion', 'POST', '/devices'],
    ['ingestion', 'PUT', '/gateways/abc-123'],
    ['ingestion', 'DELETE', '/assets/xyz'],
    ['thingsboard', 'POST', '/auth/login'],
    ['thingsboard', 'GET', '/auth/user'],
    ['thingsboard', 'POST', '/customer'],
    ['thingsboard', 'POST', '/customer/cid-1/asset/aid-1'],
    ['thingsboard', 'GET', '/tenant/devices'],
    ['thingsboard', 'POST', '/plugins/telemetry/DEVICE/id/attributes/SERVER_SCOPE'],
    ['central', 'POST', '/provision/anything'],
  ] as const)('allows %s %s %s', (target, method, path) => {
    expect(isPathAllowed(target, method, path)).toBe(true);
  });

  it.each([
    // Unknown surfaces — deny by default
    ['ingestion', 'GET', '/admin'],
    ['ingestion', 'GET', '/telemetry/raw'],
    ['thingsboard', 'GET', '/admin/settings'],
    ['thingsboard', 'GET', '/tenants'],
    // Method mismatch on an allowlisted path
    ['thingsboard', 'DELETE', '/auth/login'],
    ['thingsboard', 'PUT', '/plugins/telemetry/DEVICE/id/attributes/SERVER_SCOPE'],
    ['thingsboard', 'POST', '/tenant/devices'],
  ] as const)('denies %s %s %s', (target, method, path) => {
    expect(isPathAllowed(target, method, path)).toBe(false);
  });
});

describe('normalizeProxyPath', () => {
  it('rejects plain traversal', () => {
    expect(() => normalizeProxyPath('/customers/../admin')).toThrow(AppError);
  });

  it('rejects percent-encoded traversal (%2e%2e)', () => {
    expect(() => normalizeProxyPath('/customers/%2e%2e/admin')).toThrow(AppError);
  });

  it('rejects encoded slash smuggling that decodes into traversal', () => {
    expect(() => normalizeProxyPath('/customers%2F..%2Fadmin')).toThrow(AppError);
  });

  it('rejects backslashes and null bytes', () => {
    expect(() => normalizeProxyPath('/customers\\admin')).toThrow(AppError);
    expect(() => normalizeProxyPath('/customers%00')).toThrow(AppError);
  });

  it('keeps clean paths untouched and ensures leading slash', () => {
    expect(normalizeProxyPath('/customers/abc')).toBe('/customers/abc');
    expect(normalizeProxyPath('customers')).toBe('/customers');
  });
});

// =============================================================================
// Config: fail fast, no fallback
// =============================================================================

describe('getTargetConfig', () => {
  it('throws 503 PROXY_TARGET_NOT_CONFIGURED when env is missing', () => {
    delete process.env.THINGSBOARD_BASE_URL;
    let caught: AppError | undefined;
    try {
      getTargetConfig('thingsboard');
    } catch (err) {
      caught = err as AppError;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught?.statusCode).toBe(503);
    expect(caught?.code).toBe('PROXY_TARGET_NOT_CONFIGURED');
  });

  it('strips trailing slashes from base URLs', () => {
    process.env.PROVISIONING_BASE_URL = 'https://central.test///';
    expect(getTargetConfig('central').baseUrl).toBe('https://central.test');
  });

  it('applies per-target default timeouts (central slower)', () => {
    expect(getTargetConfig('ingestion').timeoutMs).toBe(30_000);
    expect(getTargetConfig('central').timeoutMs).toBe(120_000);
  });
});

// =============================================================================
// Ingestion token cache
// =============================================================================

describe('IngestionTokenCache', () => {
  it('fetches once and serves from cache within the freshness window', async () => {
    const fetchMock = jest.fn().mockResolvedValue(tokenResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const cache = new IngestionTokenCache();
    expect(await cache.getToken()).toBe('tok-1');
    expect(await cache.getToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent callers into one upstream request', async () => {
    const fetchMock = jest.fn().mockResolvedValue(tokenResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const cache = new IngestionTokenCache();
    const [a, b, c] = await Promise.all([cache.getToken(), cache.getToken(), cache.getToken()]);
    expect([a, b, c]).toEqual(['tok-1', 'tok-1', 'tok-1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes after 80% of the token lifetime', async () => {
    jest.useFakeTimers({ now: 0 });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('tok-1', 1000))
      .mockResolvedValueOnce(tokenResponse('tok-2', 1000));
    global.fetch = fetchMock as unknown as typeof fetch;

    const cache = new IngestionTokenCache();
    expect(await cache.getToken()).toBe('tok-1');

    // 79% of lifetime: still fresh
    jest.setSystemTime(790_000);
    expect(await cache.getToken()).toBe('tok-1');

    // Past the 80% mark: refreshed
    jest.setSystemTime(801_000);
    expect(await cache.getToken()).toBe('tok-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails with 502 (never leaking the upstream body) on auth failure', async () => {
    mockFetchOnce(500, { error: 'client_secret=oops' });
    const cache = new IngestionTokenCache();
    await expect(cache.getToken()).rejects.toMatchObject({
      statusCode: 502,
      message: expect.not.stringContaining('oops'),
    });
  });

  it('fails fast when credentials env is missing', async () => {
    delete process.env.INGESTION_CLIENT_SECRET;
    const cache = new IngestionTokenCache();
    await expect(cache.getToken()).rejects.toMatchObject({ statusCode: 503 });
  });
});

// =============================================================================
// Relay
// =============================================================================

describe('IntegrationsProxyService.relay', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  it('rejects non-allowlisted paths with 403 before any upstream call', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new IntegrationsProxyService();
    await expect(
      service.relay({ target: 'ingestion', method: 'GET', path: '/admin' })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('injects the Ingestion Bearer token and never forwards inbound credentials', async () => {
    const fetchMock = jest
      .fn()
      // token grant
      .mockResolvedValueOnce(tokenResponse('ing-tok'))
      // relayed call
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new IntegrationsProxyService();
    const result = await service.relay({
      target: 'ingestion',
      method: 'POST',
      path: '/devices',
      contentType: 'application/json',
      body: '{"name":"dev-1"}',
    });

    expect(result.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://ingestion.test/api/v1/management/devices');
    expect(init.headers['Authorization']).toBe('Bearer ing-tok');
    expect(init.headers['authorization']).toBeUndefined();
    expect(init.headers['x-api-key']).toBeUndefined();
    expect(init.headers['cookie']).toBeUndefined();
  });

  it('maps X-Target-Authorization to ThingsBoard X-Authorization under {base}/api', async () => {
    const fetchMock = mockFetchOnce(200, { id: 'tb-1' });

    const service = new IntegrationsProxyService();
    await service.relay({
      target: 'thingsboard',
      method: 'GET',
      path: '/auth/user',
      targetAuthorization: 'Bearer tb-jwt',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://tb.test/api/auth/user');
    expect(init.headers['X-Authorization']).toBe('Bearer tb-jwt');
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('requires X-Target-Authorization for TB paths except login/token', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const service = new IntegrationsProxyService();
    await expect(
      service.relay({ target: 'thingsboard', method: 'GET', path: '/auth/user' })
    ).rejects.toMatchObject({ statusCode: 401 });

    // login goes through without a target token (authenticates via body)
    const fetchMock = mockFetchOnce(200, { token: 't' });
    await service.relay({
      target: 'thingsboard',
      method: 'POST',
      path: '/auth/login',
      contentType: 'application/json',
      body: '{"username":"u","password":"p"}',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends no auth header to Central and passes query strings through', async () => {
    const fetchMock = mockFetchOnce(200, { ok: true });
    const service = new IntegrationsProxyService();
    await service.relay({ target: 'central', method: 'GET', path: '/status', query: 'a=1&b=2' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://central.test/status?a=1&b=2');
    expect(init.headers['Authorization']).toBeUndefined();
    expect(init.headers['X-Authorization']).toBeUndefined();
  });

  it('on Ingestion 401: invalidates token, re-auths, retries exactly once', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('stale-tok')) // initial grant
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 })) // relay -> 401
      .mockResolvedValueOnce(tokenResponse('fresh-tok')) // re-auth
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new IntegrationsProxyService();
    const result = await service.relay({ target: 'ingestion', method: 'GET', path: '/customers' });

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1].headers['Authorization']).toBe('Bearer fresh-tok');
  });

  it('does NOT retry a second consecutive 401 (single-attempt semantics)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('t1'))
      .mockResolvedValueOnce(new Response('no', { status: 401 }))
      .mockResolvedValueOnce(tokenResponse('t2'))
      .mockResolvedValueOnce(new Response('no', { status: 401 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new IntegrationsProxyService();
    const result = await service.relay({ target: 'ingestion', method: 'GET', path: '/customers' });

    // Upstream 401 passes through; exactly 4 calls (no retry loop)
    expect(result.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('never retries upstream 5xx (frontend owns retries)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new IntegrationsProxyService();
    const result = await service.relay({ target: 'ingestion', method: 'POST', path: '/devices', body: '{}' , contentType: 'application/json'});
    expect(result.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps network failure to 502 PROXY_TARGET_UNREACHABLE', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    const service = new IntegrationsProxyService();
    await expect(
      service.relay({ target: 'central', method: 'GET', path: '/status' })
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('logs structured access lines without secrets', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('secret-token-value'))
      .mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new IntegrationsProxyService();
    await service.relay({
      target: 'ingestion',
      method: 'GET',
      path: '/customers',
      requestId: 'req-1',
      userId: 'user-1',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      msg: 'integrations-proxy',
      requestId: 'req-1',
      userId: 'user-1',
      target: 'ingestion',
      method: 'GET',
      path: '/customers',
      status: 200,
    });
    expect(typeof parsed.latencyMs).toBe('number');
    expect(line).not.toContain('secret-token-value');
    expect(line).not.toContain('client-secret');
  });
});
