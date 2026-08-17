import { Request, Response, NextFunction } from 'express';

// =============================================================================
// In-memory token-bucket-ish rate limiter for sensitive endpoints
// (RFC-0032 Phase 2 — operator-pin).
//
// Single-instance only (per-process Map). CR-S7 follow-up: with multiple
// replicas the GLOBAL caps (central-enroll, operator-pin) become N×max — move
// those to a shared store. There is no Redis in the stack today; a Postgres
// fixed-window limiter via the existing `db` is the lightest correct option.
// The per-central poll limiter can stay per-replica (it is anti-runaway, not a
// hard global cap). The interface stays the same.
//
// Key strategies (compose at the call site):
//   - byIp(req)            → "<ip>"
//   - byHeader(req, name)  → "<header value>"
//   - composite('pin-login', byIp(req)) → "pin-login:<ip>"
// =============================================================================

interface BucketEntry {
  count: number;
  resetAt: number; // epoch ms when the count resets
}

interface RateLimitConfig {
  /** Window in milliseconds. */
  windowMs: number;
  /** Max requests in the window. */
  max: number;
  /** Function producing the bucket key. */
  keyFn: (req: Request) => string;
  /** Optional message override. Default: "Too many requests". */
  message?: string;
}

/**
 * Naive in-memory store. Map keys are bucket identifiers; values are
 * { count, resetAt }. Old entries are cleaned lazily on access.
 */
const stores = new Map<string, Map<string, BucketEntry>>();

function getStore(name: string): Map<string, BucketEntry> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

// round-3 #6: lazy per-key cleanup only reclaims keys that are hit again, so a
// stream of rotated keys (e.g. spoofed `uuid` values on the poll route) grows the
// buckets without bound. This janitor periodically drops every expired entry
// across all stores, capping memory regardless of key churn.
let janitorHandle: ReturnType<typeof setInterval> | null = null;

export function sweepExpiredBuckets(now: number = Date.now()): number {
  let removed = 0;
  for (const store of stores.values()) {
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
        removed += 1;
      }
    }
  }
  return removed;
}

/** Start the periodic bucket sweeper (idempotent). Wired from the server boot. */
export function startRateLimitJanitor(intervalMs = 5 * 60 * 1000): void {
  if (janitorHandle) return;
  janitorHandle = setInterval(() => sweepExpiredBuckets(), intervalMs);
  // don't keep the event loop alive just for cleanup
  if (typeof janitorHandle.unref === 'function') janitorHandle.unref();
}

export function stopRateLimitJanitor(): void {
  if (janitorHandle) {
    clearInterval(janitorHandle);
    janitorHandle = null;
  }
}

export function clientIp(req: Request): string {
  // CR-S7: use Express's vetted req.ip, which honours `app.set('trust proxy')`
  // — a spoofed X-Forwarded-For from beyond the trusted hop count is ignored.
  // Reading the raw XFF here (as before) let any client forge their bucket key.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Non-middleware fixed-window check: same bucket mechanics as `rateLimit()`
 * below, but directly callable from application code that needs to gate on
 * an OUTCOME rather than on request entry (e.g. RFC-0056's "successful
 * reveal count per uuid" dimension, which must not consume budget on every
 * call — only on ones the caller decides to count). Always increments on
 * call; the caller decides when to call it.
 */
export function consumeIfAllowed(
  name: string,
  key: string,
  config: { windowMs: number; max: number },
): { allowed: boolean; retryAfterSeconds: number } {
  const store = getStore(name);
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  entry.count += 1;
  if (entry.count > config.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Build a rate limit middleware bound to a named bucket store. Each
 * named bucket is independent — `operator-pin` requests don't consume
 * the budget of `password-login` requests, etc.
 */
export function rateLimit(name: string, config: RateLimitConfig) {
  const store = getStore(name);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = config.keyFn(req);
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      // Fresh window
      store.set(key, { count: 1, resetAt: now + config.windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > config.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: config.message ?? 'Too many requests; please try again later',
          retryAfter,
        },
        meta: {
          requestId: req.context?.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    next();
  };
}

/**
 * Operator-PIN endpoint: 10 attempts / 5 minutes / IP. Per-user lockout
 * is layered on top inside AuthService.loginByPin.
 */
export const operatorPinRateLimiter = rateLimit('operator-pin', {
  windowMs: 5 * 60 * 1000,
  max: 10,
  keyFn: (req) => clientIp(req),
  message: 'Too many PIN login attempts; wait before retrying',
});

/**
 * Central zero-touch enrollment: a PUBLIC endpoint where the one-time enroll
 * token IS the credential, so throttle by IP to blunt token brute-forcing /
 * enroll abuse. Enrollment is rare (once per central; re-enroll only on a
 * field-swap), so the window is generous but finite.
 */
export const centralEnrollRateLimiter = rateLimit('central-enroll', {
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyFn: (req) => clientIp(req),
  message: 'Too many enrollment attempts; wait before retrying',
});

/**
 * Central poll loop (jobs/next + progress reports). Authenticated by the
 * agent-secret JWT, but rate-limited per-central so a single runaway/compromised
 * device cannot hammer the control plane. Keyed by the `uuid` header so each
 * central is its own bucket (many centrals behind one NAT do not starve each
 * other); falls back to IP when the header is absent. A healthy central polls
 * every 30s (~2/min); 60/min leaves ample room for retries while bounding abuse.
 */
export const centralPollRateLimiter = rateLimit('central-poll', {
  windowMs: 60 * 1000,
  max: 60,
  keyFn: (req) => {
    const u = req.headers['uuid'];
    return typeof u === 'string' && u ? `central:${u}` : `ip:${clientIp(req)}`;
  },
  message: 'Too many central-agent requests; slow down the poll loop',
});

/**
 * Outer per-IP bound for the central poll route, composed BEFORE the per-central
 * limiter. The per-central limiter keys on the unauthenticated `uuid` header
 * (it runs before centralAuthMiddleware), so an attacker rotating arbitrary uuids
 * would otherwise get a fresh 60/min bucket per value and drive an unbounded
 * number of getByUuid lookups in the auth gate (a DoS amplification). This caps
 * total PRE-AUTH poll load per source IP regardless of header spoofing, while
 * staying generous for a real fleet of centrals behind one NAT (each polls ~2/min,
 * so 600/min ≈ 300 centrals with retry headroom).
 */
export const centralPollIpRateLimiter = rateLimit('central-poll-ip', {
  windowMs: 60 * 1000,
  max: 600,
  keyFn: (req) => clientIp(req),
  message: 'Too many central-agent requests from this source; slow down',
});

/**
 * RFC-0056 bootstrap (`GET /public/central/initial-key`) — PUBLIC, secret-
 * returning endpoint, so it needs its own dimensions rather than reusing
 * central-enroll's. Two of the RFC's four dimensions (IP, uuid) are plain
 * request-entry windows and fit the standard `rateLimit()` middleware; the
 * other two (pre-key failure lockout, successful-reveal count) depend on the
 * request OUTCOME and are implemented inside `centralPreKeyAuth` /
 * `CentralInitialKeyService` via `consumeIfAllowed`.
 *
 * Numbers are proposed by analogy to centralEnrollRateLimiter (bootstrap is
 * similarly rare — once per central, occasional firmware retries) — no
 * threshold is specified in the RFC itself; adjust freely.
 */
export const centralBootstrapIpRateLimiter = rateLimit('central-bootstrap-ip', {
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyFn: (req) => clientIp(req),
  message: 'Too many bootstrap attempts from this source; wait before retrying',
});

export const centralBootstrapUuidRateLimiter = rateLimit('central-bootstrap-uuid', {
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyFn: (req) => {
    const u = req.headers['uuid'];
    return typeof u === 'string' && u ? `central:${u}` : `ip:${clientIp(req)}`;
  },
  message: 'Too many bootstrap attempts for this central; wait before retrying',
});
