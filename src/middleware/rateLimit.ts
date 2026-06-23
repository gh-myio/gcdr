import { Request, Response, NextFunction } from 'express';

// =============================================================================
// In-memory token-bucket-ish rate limiter for sensitive endpoints
// (RFC-0032 Phase 2 — operator-pin).
//
// Single-instance only. If the deployment scales horizontally, replace the
// internal Map with Redis. The interface stays the same.
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

export function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    return xff.split(',')[0]?.trim() || 'unknown';
  }
  return req.socket?.remoteAddress || 'unknown';
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
