import * as crypto from 'crypto';

// =============================================================================
// AES-256-GCM envelope for secrets at rest (CR-S3).
//
// Some secrets — notably a central's agent_secret — are long-lived HMAC keys
// that must stay USABLE (can't be hashed like a one-time enroll token). A DB
// dump of plaintext secrets would let an attacker forge poll-loop tokens for
// every central, so we encrypt them at rest with an authenticated cipher.
//
// Stored format (fits the existing `text` column, no schema change):
//   v1:<b64url(iv)>:<b64url(authTag)>:<b64url(ciphertext)>
// The `v1:` prefix lets decryptSecret tell an envelope from a legacy plaintext
// value, so existing rows keep working during a phased migration.
//
// Key: process.env.SECRET_ENCRYPTION_KEY — a 32-byte key as 64 hex chars or
// base64, otherwise any string is stretched to 32 bytes via scrypt. Required;
// encrypt/decrypt of an envelope throws if it is unset (fail fast in prod).
// =============================================================================

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard 96-bit nonce
const KEY_BYTES = 32; // AES-256

// Memoize the derived key. `decryptSecret` runs on the central-agent auth hot
// path (every poll), and a passphrase-format key re-derives via scryptSync — a
// deliberately slow KDF that would block the event loop on every request. The
// key is fixed for the process lifetime, so derive once per distinct raw value.
let cachedKey: Buffer | null = null;
let cachedFromRaw: string | null = null;

function deriveKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const asB64 = Buffer.from(raw, 'base64');
  if (asB64.length === KEY_BYTES) return asB64;
  return crypto.scryptSync(raw, 'gcdr-secret-envelope', KEY_BYTES);
}

function getKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY is not set — cannot encrypt/decrypt secrets at rest (CR-S3)',
    );
  }
  if (cachedKey && cachedFromRaw === raw) return cachedKey;
  cachedKey = deriveKey(raw);
  cachedFromRaw = raw;
  return cachedKey;
}

/**
 * Boot-time validation (CR/round-3 #8): fail fast at startup rather than as a
 * request-time 500 if SECRET_ENCRYPTION_KEY is missing or does not resolve to a
 * 32-byte key. Call this from the server bootstrap. Returns nothing; throws on
 * misconfiguration so the process refuses to start.
 */
export function validateSecretEncryptionKey(): void {
  const key = getKey(); // throws if unset
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRET_ENCRYPTION_KEY must resolve to ${KEY_BYTES} bytes (got ${key.length}); ` +
        'provide 64 hex chars, 32-byte base64, or a passphrase',
    );
  }
}

function b64u(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function unb64u(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** True when `value` is a v1 envelope (vs a legacy plaintext secret). */
export function isEnvelope(value: string): boolean {
  return value.startsWith(`${VERSION}:`) && value.split(':').length === 4;
}

/** Encrypt a plaintext secret into a self-describing v1 envelope string. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${b64u(iv)}:${b64u(tag)}:${b64u(ct)}`;
}

/**
 * Decrypt a v1 envelope back to plaintext. A value that is NOT an envelope is
 * returned unchanged (legacy plaintext passthrough), so a phased migration and
 * the back-compat read path work. Throws on a tampered/invalid envelope.
 */
export function decryptSecret(value: string): string {
  if (!isEnvelope(value)) return value;
  const [, ivB, tagB, ctB] = value.split(':');
  const decipher = crypto.createDecipheriv(ALGO, getKey(), unb64u(ivB));
  decipher.setAuthTag(unb64u(tagB));
  return Buffer.concat([decipher.update(unb64u(ctB)), decipher.final()]).toString('utf8');
}
