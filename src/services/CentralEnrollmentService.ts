import * as crypto from 'crypto';
import { centralRepository } from '../repositories/CentralRepository';
import { NotFoundError, UnauthorizedError } from '../shared/errors/AppError';

// Enroll-token lifetime: long enough to flash + first-boot a central, short
// enough that a leaked .bootstrap is not indefinitely useful.
const ENROLL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
// 32 random bytes → 64 hex chars. Comfortably above the EnrollCentralSchema
// min(20) floor and well beyond brute-force range.
const ENROLL_TOKEN_BYTES = 32;
const AGENT_SECRET_BYTES = 32; // 256-bit HMAC key for the poll-loop HS256 JWT.

/** Result of issuing an enroll token (the plaintext is returned ONCE). */
export interface IssueEnrollTokenResult {
  enrollToken: string;
  expiresAt: string;
}

/** Result of a successful enroll (the agent_secret is returned ONCE). */
export interface EnrollResult {
  agentSecret: string;
}

// Minimal structural deps so the service is unit-testable (mirrors
// CentralBackupService's constructor-injection). Defaults wire the real
// singleton for production use.
type CentralRepoDep = Pick<
  typeof centralRepository,
  'setEnrollToken' | 'getByUuid' | 'completeEnrollment'
>;

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Zero-touch central provisioning (Slice 1.5).
 *
 * An operator issues a one-time enroll token for a central; gcdr stores only its
 * sha256 hash + an expiry on the central row. The central — freshly flashed,
 * carrying the plaintext token in its .bootstrap — exchanges that token for a
 * freshly-minted `agent_secret` via the device-facing enroll endpoint, with NO
 * prior credential (the enroll token IS the credential). The exchange clears the
 * token so it is single-use; re-issuing a fresh token re-enables enrollment
 * (needed for field-swap, where new hardware adopts the old central's id).
 */
export class CentralEnrollmentService {
  constructor(
    private readonly centrals: CentralRepoDep = centralRepository,
  ) {}

  /**
   * Issue a one-time enroll token for a central (operator path, tenant-aware).
   * Generates a cryptographically-random token, stores ONLY its sha256 hash +
   * an expiry (default 24h) on the central row, and returns the PLAINTEXT token
   * + expiry. The plaintext is returned once and never stored.
   */
  async issueEnrollToken(tenantId: string, centralId: string): Promise<IssueEnrollTokenResult> {
    const enrollToken = crypto.randomBytes(ENROLL_TOKEN_BYTES).toString('hex');
    const enrollTokenHash = sha256Hex(enrollToken);
    const expiresAt = new Date(Date.now() + ENROLL_TOKEN_TTL_MS);

    const row = await this.centrals.setEnrollToken(tenantId, centralId, enrollTokenHash, expiresAt);
    if (!row) throw new NotFoundError(`Central ${centralId} not found`);

    return { enrollToken, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Exchange a one-time enroll token for a freshly-minted agent_secret
   * (device-facing, cross-tenant by uuid — the central only knows its own id).
   *
   * Verifies the central exists, has a pending (un-consumed) token, the token is
   * not expired, and sha256(enrollToken) matches the stored hash via a constant-
   * time compare. On success mints a random agent_secret, persists it, stamps
   * enrolled_at, and CLEARS the token (single-use). Throws on every failure path
   * so the device cannot distinguish unknown-uuid from bad-token by timing alone
   * (all reasons surface as UnauthorizedError except unknown uuid → NotFound).
   */
  async enroll(uuid: string, enrollToken: string): Promise<EnrollResult> {
    const central = await this.centrals.getByUuid(uuid);
    if (!central) throw new NotFoundError(`Central ${uuid} not found`);

    if (!central.enrollTokenHash) {
      throw new UnauthorizedError('No pending enrollment for this central');
    }
    if (
      central.enrollTokenExpiresAt &&
      new Date(central.enrollTokenExpiresAt).getTime() < Date.now()
    ) {
      throw new UnauthorizedError('Enrollment token expired');
    }

    if (!this.tokenMatches(enrollToken, central.enrollTokenHash)) {
      throw new UnauthorizedError('Invalid enrollment token');
    }

    const agentSecret = crypto.randomBytes(AGENT_SECRET_BYTES).toString('hex');
    const updated = await this.centrals.completeEnrollment(uuid, agentSecret, new Date());
    if (!updated) throw new NotFoundError(`Central ${uuid} not found`);

    return { agentSecret };
  }

  /** Constant-time compare of sha256(token) against the stored hash. */
  private tokenMatches(enrollToken: string, storedHash: string): boolean {
    const provided = Buffer.from(sha256Hex(enrollToken), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    // Equal length by construction (both 32-byte sha256 digests), but guard
    // against a malformed stored hash so timingSafeEqual never throws.
    if (provided.length !== stored.length) return false;
    return crypto.timingSafeEqual(provided, stored);
  }
}

export const centralEnrollmentService = new CentralEnrollmentService();
