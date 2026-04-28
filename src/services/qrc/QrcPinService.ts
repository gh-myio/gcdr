import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

// =============================================================================
// RFC-0032 Phase 2 — QR Checker PIN crypto helpers.
//
// Two-column design rationale (also documented in migration 0024 + RFC):
//
//   qrc_field_pin_lookup CHAR(64)
//     deterministic HMAC-SHA256(QRC_PIN_PEPPER, tenantId || ':' || pin)
//     → fast O(1) lookup AND real per-tenant unique constraint
//
//   qrc_field_pin_hash TEXT
//     bcrypt(pin) with cost 10
//     → slow offline cracking; even if the lookup column is leaked, an
//       attacker still must brute-force bcrypt to verify
//
// Pepper from env var QRC_PIN_PEPPER (≥ 32 hex chars). Rotating the
// pepper invalidates ALL stored PINs.
// =============================================================================

const PEPPER_ENV = 'QRC_PIN_PEPPER';
const BCRYPT_COST = 10;

/**
 * Read the pepper at call time so a missing/invalid value surfaces a
 * descriptive error from the actual operation that needs it (login,
 * PIN-set) rather than at module load. This also lets test suites
 * temporarily override it via process.env.
 */
function readPepper(): string {
  const pepper = process.env[PEPPER_ENV];
  if (!pepper || pepper.length < 32) {
    throw new Error(
      `${PEPPER_ENV} must be set and contain at least 32 hex characters. ` +
      `Generate one once via: openssl rand -hex 32`
    );
  }
  return pepper;
}

/**
 * Deterministic lookup token. The same (tenantId, pin) pair always
 * produces the same 64-char hex string — this is what gets indexed.
 *
 * Format: HMAC-SHA256(pepper, `${tenantId}:${pin}`).
 *
 * Why HMAC and not plain SHA-256: HMAC binds the digest to the pepper
 * so a leaked DB without the pepper cannot be brute-forced offline by
 * just enumerating 10 000 PINs through SHA-256.
 */
export function pinLookupToken(tenantId: string, pin: string): string {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits');
  }
  if (!tenantId) {
    throw new Error('tenantId is required for PIN lookup token');
  }
  return createHmac('sha256', readPepper())
    .update(`${tenantId}:${pin}`)
    .digest('hex');
}

/**
 * Slow, salted hash for verify-time comparison. NEVER used for lookup.
 * Cost factor 10 ≈ 100 ms per verify on modern hardware — fast enough
 * for a login response, slow enough to make offline brute force costly.
 */
export async function pinHash(pin: string): Promise<string> {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits');
  }
  return bcrypt.hash(pin, BCRYPT_COST);
}

/**
 * Verify a candidate PIN against a stored bcrypt hash.
 * Constant-time on the bcrypt side (bcrypt.compare uses timingSafeEqual
 * internally on the hash material).
 */
export async function pinVerify(pin: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  if (!/^\d{4}$/.test(pin)) return false;
  return bcrypt.compare(pin, hash);
}

/**
 * Convenience wrapper: produce both columns at once for a fresh PIN.
 * Use this on PIN-set operations (admin assigning a new PIN to a field
 * operator).
 */
export async function pinColumnsForWrite(tenantId: string, pin: string): Promise<{
  lookup: string;
  hash: string;
}> {
  const [lookup, hash] = await Promise.all([
    Promise.resolve(pinLookupToken(tenantId, pin)),
    pinHash(pin),
  ]);
  return { lookup, hash };
}

/**
 * Constant-time string compare for any other PIN-adjacent comparisons
 * (defence in depth — bcrypt.compare already does this internally).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
