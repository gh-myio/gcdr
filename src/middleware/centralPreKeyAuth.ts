import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { UnauthorizedError } from '../shared/errors/AppError';
import { centralRepository } from '../repositories/CentralRepository';
import { clientIp } from './rateLimit';
 
// =============================================================================
// RFC-0056 — Central API Key Bootstrap: pre-key authentication.
//
// Gates `GET /api/v1/public/central/initial-key`. Unlike centralAuth.ts (which
// HMAC-verifies a PER-CENTRAL secret, agent_secret), the pre-key is a single
// GLOBAL shared secret (CENTRAL_PRE_INITIAL_API_KEY) — identical across every
// central in the fleet, the same value hardcoded in firmware. It carries no
// scope and has no customer_api_keys row (DEC-2): just an env-var compare.
//
// DEC-5: every failure (bad pre-key / malformed uuid / unknown central)
// returns the SAME generic 401 — no enumeration oracle. To keep timing
// consistent across failure reasons, the pre-key compare and the central
// lookup both always run regardless of each other's outcome (same posture as
// CentralEnrollmentService.enroll's decoy compare).
//
// Also implements DEC-5's "pre-key failure count (progressive lockout)"
// dimension — not covered by the plain request-entry window in
// centralBootstrapIpRateLimiter (rateLimit.ts), since a lockout only grows on
// FAILURE and resets on success. Keyed by IP (the pre-key is a single global
// secret, not per-central, so locking by IP — not by uuid — is what actually
// slows down a brute-force of it; a global/uuid-only lock would let one
// attacker DoS the whole fleet's bootstrap).
// =============================================================================
 
/** Identity of the central resolved during bootstrap, set on req.centralBootstrapContext. */
export interface CentralBootstrapIdentity {
  centralId: string;
  tenantId: string;
  config: Record<string, unknown>;
}
 
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Populated by centralPreKeyAuth after a successful bootstrap auth.
      centralBootstrapContext?: CentralBootstrapIdentity;
    }
  }
}
 
// Structural dep for unit testing — mirrors the DI style used by centralAuth.ts.
type CentralRepoDep = Pick<typeof centralRepository, 'getByUuid'>;
 
// Same rationale as centralAuth.ts's UUID_RE: reject a malformed uuid as 401
// BEFORE it reaches getByUuid (avoids a SQL-leaking 500) and keeps this from
// being a status/enumeration oracle.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
 
const GENERIC_FAILURE_MESSAGE = 'Invalid bootstrap credentials';
 
const FAILURE_THRESHOLD = 5;
const BASE_LOCKOUT_MS = 5 * 60 * 1000; // 5 min
const MAX_LOCKOUT_MS = 60 * 60 * 1000; // 60 min cap
// Old failures don't accumulate toward a lockout forever — an IP that failed
// once weeks ago shouldn't start a fresh attempt at FAILURE_THRESHOLD - 1.
const FAILURE_DECAY_MS = 30 * 60 * 1000;
 
interface LockoutEntry {
  failCount: number;
  lastFailureAt: number;
  lockedUntil: number;
}
 
const lockoutStore = new Map<string, LockoutEntry>();
 
// Same bounded-memory-under-churn idiom as rateLimit.ts's bucket sweeper.
let janitorHandle: ReturnType<typeof setInterval> | null = null;
 
export function sweepExpiredLockouts(now: number = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of lockoutStore) {
    if (entry.lockedUntil <= now && now - entry.lastFailureAt > FAILURE_DECAY_MS) {
      lockoutStore.delete(key);
      removed += 1;
    }
  }
  return removed;
}
 
/** Start the periodic lockout-store sweeper (idempotent). Wired from server boot. */
export function startLockoutJanitor(intervalMs = 5 * 60 * 1000): void {
  if (janitorHandle) return;
  janitorHandle = setInterval(() => sweepExpiredLockouts(), intervalMs);
  if (typeof janitorHandle.unref === 'function') janitorHandle.unref();
}
 
export function stopLockoutJanitor(): void {
  if (janitorHandle) {
    clearInterval(janitorHandle);
    janitorHandle = null;
  }
}
 
/** Seconds remaining if locked out, or null if not locked. */
function lockedForSeconds(key: string): number | null {
  const entry = lockoutStore.get(key);
  if (!entry || entry.lockedUntil <= Date.now()) return null;
  return Math.ceil((entry.lockedUntil - Date.now()) / 1000);
}
 
function recordFailure(key: string): void {
  const now = Date.now();
  const existing = lockoutStore.get(key);
  const stale = !existing || now - existing.lastFailureAt > FAILURE_DECAY_MS;
  const failCount = stale ? 1 : existing.failCount + 1;
 
  let lockedUntil = 0;
  if (failCount > FAILURE_THRESHOLD) {
    const durationMs = Math.min(
      BASE_LOCKOUT_MS * 2 ** (failCount - FAILURE_THRESHOLD - 1),
      MAX_LOCKOUT_MS,
    );
    lockedUntil = now + durationMs;
  }
 
  lockoutStore.set(key, { failCount, lastFailureAt: now, lockedUntil });
}
 
function recordSuccess(key: string): void {
  lockoutStore.delete(key);
}
 
/**
 * Constant-time compare. When lengths differ, still burns a same-shaped
 * compare against a decoy of the provided value's length so a length
 * mismatch doesn't resolve faster than a full mismatch.
 */
function timingSafeEqualStrings(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    crypto.timingSafeEqual(providedBuf, Buffer.alloc(providedBuf.length));
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
 
/**
 * Factory so unit tests can inject a mock CentralRepository. The default
 * export (`centralPreKeyAuth`) is wired to the real singleton.
 */
export function makeCentralPreKeyAuth(centrals: CentralRepoDep = centralRepository) {
  return async function centralPreKeyAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const lockoutKey = clientIp(req);
      const retryAfter = lockedForSeconds(lockoutKey);
      if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many failed bootstrap attempts; wait before retrying',
            retryAfter,
          },
          meta: { requestId: req.context?.requestId, timestamp: new Date().toISOString() },
        });
        return;
      }
 
      const providedKey = req.headers['x-central-pre-key'];
      const uuidHeader = req.headers['uuid'];
      // DEC-2/DEC-8: missing env var ⇒ bootstrap fails closed, no exceptions.
      const expectedKey = process.env.CENTRAL_PRE_INITIAL_API_KEY;
 
      const keyOk =
        typeof expectedKey === 'string' &&
        expectedKey.length > 0 &&
        typeof providedKey === 'string' &&
        providedKey.length > 0 &&
        timingSafeEqualStrings(providedKey, expectedKey);
 
      const uuidFormatOk = typeof uuidHeader === 'string' && UUID_RE.test(uuidHeader);
 
      // Always attempt the lookup when the uuid is well-formed, independent of
      // whether the pre-key already failed — keeps the two checks' timing from
      // leaking which one failed via an early return.
      const central = uuidFormatOk ? await centrals.getByUuid(uuidHeader as string) : null;
 
      if (!keyOk || !central) {
        recordFailure(lockoutKey);
        throw new UnauthorizedError(GENERIC_FAILURE_MESSAGE);
      }
 
      recordSuccess(lockoutKey);
      req.centralBootstrapContext = {
        centralId: central.id,
        tenantId: central.tenantId,
        config: (central.config as Record<string, unknown>) ?? {},
      };
 
      next();
    } catch (err) {
      next(err);
    }
  };
}
 
export const centralPreKeyAuth = makeCentralPreKeyAuth();
 