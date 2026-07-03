/**
 * RFC-0050 — Pre-Setup Integrations Proxy (phase B2).
 *
 * Pure relay from the ported presetup UI to the non-GCDR backends of the
 * provisioning cascade (Ingestion, ThingsBoard, Central provisioning), so the
 * secrets that the old Next.js API routes injected never reach the browser.
 *
 * Design constraints (see docs/rfcs/RFC-0050-Presetup-Migration-to-GCDR.md):
 * - Deny-by-default path allowlist per target, declared as a data table.
 * - The relay NEVER forwards the caller's GCDR credentials (Authorization,
 *   X-API-Key, Cookie) upstream. Ingestion gets the server-side OAuth token;
 *   ThingsBoard gets the operator's TB JWT from X-Target-Authorization;
 *   Central gets no auth (legacy provisioning service).
 * - Zero retries on upstream errors — the frontend sync engine owns retry UX.
 *   The single exception: an Ingestion 401 invalidates the cached token and
 *   re-issues the request once (an auth rejection means it was not executed).
 * - Per-target timeouts; upstream status passes through untouched.
 * - Fail fast when a target's env vars are missing — never fall back to a
 *   default URL (the old presetup defaulted to Ingestion STAGING; that class
 *   of bug is what this rule kills).
 */
import { AppError } from '../shared/errors/AppError';

export type ProxyTarget = 'ingestion' | 'thingsboard' | 'central';

const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

interface AllowRule {
  methods: readonly string[];
  pattern: RegExp;
}

/**
 * Deny-by-default allowlist. Paths are matched after normalization (leading
 * slash, no query string). Extend with one line per new upstream surface —
 * never widen a pattern to "make something work" without recording why.
 */
export const PROXY_ALLOWLIST: Record<ProxyTarget, readonly AllowRule[]> = {
  // Ingestion management API (customers/assets/gateways/devices CRUD used by
  // the presetup sync planner/applier).
  ingestion: [
    { methods: ALL_METHODS, pattern: /^\/customers(\/|$)/ },
    { methods: ALL_METHODS, pattern: /^\/customers$/ },
    { methods: ALL_METHODS, pattern: /^\/assets(\/|$)/ },
    { methods: ALL_METHODS, pattern: /^\/assets$/ },
    { methods: ALL_METHODS, pattern: /^\/gateways(\/|$)/ },
    { methods: ALL_METHODS, pattern: /^\/gateways$/ },
    { methods: ALL_METHODS, pattern: /^\/devices(\/|$)/ },
    { methods: ALL_METHODS, pattern: /^\/devices$/ },
  ],
  // ThingsBoard REST API (paths are relative to {base}/api). Covers the
  // surfaces the presetup TB sync uses: operator auth, customer/asset/device
  // CRUD + assignment, relations, and SERVER_SCOPE attribute writes.
  thingsboard: [
    { methods: ['POST'], pattern: /^\/auth\/(login|token)$/ },
    { methods: ['GET'], pattern: /^\/auth\/user$/ },
    { methods: ALL_METHODS, pattern: /^\/customers?($|\/)/ },
    { methods: ALL_METHODS, pattern: /^\/assets?($|\/)/ },
    { methods: ALL_METHODS, pattern: /^\/devices?($|\/)/ },
    { methods: ALL_METHODS, pattern: /^\/relations?($|\/)/ },
    { methods: ['GET'], pattern: /^\/tenant\/(customers|assets|devices)($|\/)/ },
    { methods: ['GET', 'POST', 'DELETE'], pattern: /^\/plugins\/telemetry\// },
  ],
  // Central provisioning service: legacy surface without a published contract.
  // Relayed wholesale (bounded by the role gate + this module's header
  // hygiene); tighten to explicit paths once the surface is mapped in B3.
  central: [{ methods: ALL_METHODS, pattern: /^\// }],
};

/**
 * Normalizes and validates a relay path. Rejects traversal attempts before
 * any allowlist matching (defense in depth — the allowlist patterns are
 * anchored, but a `..` that survives into the upstream URL is never OK).
 */
export function normalizeProxyPath(rawPath: string): string {
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  let decoded = path;
  try {
    // Collapse percent-encoding so /%2e%2e/ can't sneak past the check below.
    decoded = decodeURIComponent(path);
  } catch {
    throw new AppError('PROXY_PATH_INVALID', 'Invalid proxy path encoding', 400);
  }
  if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) {
    throw new AppError('PROXY_PATH_NOT_ALLOWED', 'Proxy path not allowed', 403);
  }
  return path;
}

export function isPathAllowed(target: ProxyTarget, method: string, path: string): boolean {
  const rules = PROXY_ALLOWLIST[target];
  const m = method.toUpperCase();
  return rules.some((rule) => rule.methods.includes(m) && rule.pattern.test(path));
}

// =============================================================================
// Per-target configuration (env, fail fast — no defaults)
// =============================================================================

export interface TargetConfig {
  baseUrl: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS: Record<ProxyTarget, number> = {
  ingestion: 30_000,
  thingsboard: 30_000,
  // Central provisioning is legitimately slow (device flashing/config push).
  central: 120_000,
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AppError(
      'PROXY_TARGET_NOT_CONFIGURED',
      `Integrations proxy target not configured: missing ${name}`,
      503
    );
  }
  return value;
}

export function getTargetConfig(target: ProxyTarget): TargetConfig {
  const envByTarget: Record<ProxyTarget, string> = {
    ingestion: 'INGESTION_API_BASE_URL',
    thingsboard: 'THINGSBOARD_BASE_URL',
    central: 'PROVISIONING_BASE_URL',
  };
  const baseUrl = requiredEnv(envByTarget[target]).replace(/\/+$/, '');
  const timeoutOverride = process.env[`PROXY_TIMEOUT_${target.toUpperCase()}_MS`];
  const timeoutMs = timeoutOverride ? parseInt(timeoutOverride, 10) : DEFAULT_TIMEOUT_MS[target];
  return { baseUrl, timeoutMs };
}

// =============================================================================
// Ingestion OAuth token cache (client-credentials, server-side only)
// =============================================================================

interface CachedToken {
  token: string;
  /** Epoch ms after which the cached token is considered stale. */
  staleAt: number;
}

/**
 * Refresh at 80% of the token lifetime so a token is never used near expiry.
 * In-memory and per-process by design: with multiple GCDR instances each
 * process caches independently, which only costs extra token grants — do not
 * "fix" this with a shared store.
 */
const REFRESH_AT_FRACTION = 0.8;

export class IngestionTokenCache {
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  invalidate(): void {
    this.cached = null;
  }

  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.staleAt) {
      return this.cached.token;
    }
    // Single-flight: concurrent callers share one upstream token request.
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const authUrl = requiredEnv('INGESTION_AUTH_URL');
    const clientId = requiredEnv('INGESTION_CLIENT_ID');
    const clientSecret = requiredEnv('INGESTION_CLIENT_SECRET');

    let upstream: Response;
    try {
      upstream = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new AppError(
        'PROXY_AUTH_UNREACHABLE',
        `Ingestion auth unreachable: ${err instanceof Error ? err.message : String(err)}`,
        502
      );
    }

    if (!upstream.ok) {
      // Never include the upstream body here — it may echo credentials.
      throw new AppError('PROXY_AUTH_FAILED', `Ingestion auth failed: HTTP ${upstream.status}`, 502);
    }

    const json = (await upstream.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
    } | null;

    if (!json?.access_token || !json?.expires_in) {
      throw new AppError('PROXY_AUTH_FAILED', 'Ingestion auth response missing fields', 502);
    }

    this.cached = {
      token: json.access_token,
      staleAt: Date.now() + json.expires_in * 1000 * REFRESH_AT_FRACTION,
    };
    return json.access_token;
  }
}

// =============================================================================
// Relay
// =============================================================================

export interface RelayRequest {
  target: ProxyTarget;
  method: string;
  /** Path relative to the target base URL, already stripped of the mount prefix. */
  path: string;
  /** Raw query string without the leading `?` (passed through untouched). */
  query?: string;
  contentType?: string;
  /** Raw request body; only forwarded when non-empty. */
  body?: Buffer | string;
  /** Operator's ThingsBoard JWT (from X-Target-Authorization), TB target only. */
  targetAuthorization?: string;
  requestId?: string;
  userId?: string;
}

export interface RelayResponse {
  status: number;
  contentType: string | null;
  body: Buffer;
}

export class IntegrationsProxyService {
  constructor(private readonly tokenCache: IngestionTokenCache = new IngestionTokenCache()) {}

  async relay(req: RelayRequest): Promise<RelayResponse> {
    const path = normalizeProxyPath(req.path);
    if (!isPathAllowed(req.target, req.method, path)) {
      throw new AppError(
        'PROXY_PATH_NOT_ALLOWED',
        `Proxy path not allowed for target ${req.target}: ${req.method} ${path}`,
        403
      );
    }

    const config = getTargetConfig(req.target);
    const startedAt = Date.now();
    let response = await this.forward(req, path, config);

    // Ingestion 401 → stale token: invalidate, re-auth, re-issue exactly once.
    if (req.target === 'ingestion' && response.status === 401) {
      this.tokenCache.invalidate();
      response = await this.forward(req, path, config);
    }

    // Structured access log: never bodies, never tokens (Amelia/RFC-0050).
    // eslint-disable-next-line no-console -- structured proxy access log
    console.info(
      JSON.stringify({
        msg: 'integrations-proxy',
        requestId: req.requestId,
        userId: req.userId,
        target: req.target,
        method: req.method.toUpperCase(),
        path,
        status: response.status,
        latencyMs: Date.now() - startedAt,
      })
    );

    return response;
  }

  private async buildHeaders(req: RelayRequest, path: string): Promise<Record<string, string>> {
    // Built from scratch — inbound Authorization/X-API-Key/Cookie never pass.
    const headers: Record<string, string> = {};
    if (req.contentType) headers['Content-Type'] = req.contentType;

    // TB login authenticates via body; token refresh carries the refresh
    // token in the body — neither takes an X-Authorization header.
    const isTbPublicAuthPath = path === '/auth/login' || path === '/auth/token';

    if (req.target === 'ingestion') {
      headers['Authorization'] = `Bearer ${await this.tokenCache.getToken()}`;
    } else if (req.target === 'thingsboard' && !isTbPublicAuthPath) {
      if (!req.targetAuthorization) {
        throw new AppError(
          'PROXY_TARGET_AUTH_REQUIRED',
          'X-Target-Authorization header required for ThingsBoard proxy',
          401
        );
      }
      const value = req.targetAuthorization.startsWith('Bearer ')
        ? req.targetAuthorization
        : `Bearer ${req.targetAuthorization}`;
      headers['X-Authorization'] = value;
    }
    return headers;
  }

  private async forward(
    req: RelayRequest,
    path: string,
    config: TargetConfig
  ): Promise<RelayResponse> {
    // ThingsBoard's REST base is {host}/api; the other targets mount at root.
    const targetBase = req.target === 'thingsboard' ? `${config.baseUrl}/api` : config.baseUrl;
    const querySuffix = req.query ? `?${req.query}` : '';
    const url = `${targetBase}${path}${querySuffix}`;
    const headers = await this.buildHeaders(req, path);

    const hasBody =
      req.body !== undefined && req.body !== null && Buffer.byteLength(req.body as never) > 0;

    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: req.method.toUpperCase(),
        headers,
        ...(hasBody ? { body: req.body } : {}),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      throw new AppError(
        isTimeout ? 'PROXY_TARGET_TIMEOUT' : 'PROXY_TARGET_UNREACHABLE',
        `Proxy target ${req.target} ${isTimeout ? 'timed out' : 'unreachable'}`,
        isTimeout ? 504 : 502
      );
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return {
      status: upstream.status,
      contentType: upstream.headers.get('content-type'),
      body,
    };
  }
}

export const integrationsProxyService = new IntegrationsProxyService();
