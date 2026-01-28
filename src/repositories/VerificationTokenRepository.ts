import { eq, and, gt, isNull, lt } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import * as crypto from 'crypto';

const { verificationTokens, users } = schema;

// Token types
export type VerificationTokenType = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'ACCOUNT_UNLOCK';

// Token entity
export interface VerificationToken {
  id: string;
  tenantId: string;
  userId: string;
  tokenType: VerificationTokenType;
  codeHash: string;
  expiresAt: string;
  usedAt?: string;
  attempts: number;
  maxAttempts: number;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

// Token creation result
export interface CreateTokenResult {
  token: VerificationToken;
  code: string;  // Plain text code to send to user
}

// Configuration
const TOKEN_EXPIRY_MINUTES = 15;
const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Generates a cryptographically secure 6-digit code
 */
function generateVerificationCode(): string {
  const buffer = crypto.randomBytes(4);
  const number = buffer.readUInt32BE(0) % 1000000;
  return number.toString().padStart(6, '0');
}

/**
 * Hashes a verification code using SHA-256
 */
function hashVerificationCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export class VerificationTokenRepository {

  /**
   * Create a new verification token and return the plain text code
   */
  async create(
    tenantId: string,
    userId: string,
    tokenType: VerificationTokenType,
    ipAddress?: string,
    userAgent?: string
  ): Promise<CreateTokenResult> {
    // Invalidate any existing active tokens of this type for this user
    await this.invalidateExisting(tenantId, userId, tokenType);

    const id = generateId();
    const timestamp = now();
    const code = generateVerificationCode();
    const codeHash = hashVerificationCode(code);

    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    const [result] = await db.insert(verificationTokens).values({
      id,
      tenantId,
      userId,
      tokenType,
      codeHash,
      expiresAt,
      attempts: 0,
      maxAttempts: MAX_VERIFICATION_ATTEMPTS,
      ipAddress,
      userAgent,
      createdAt: new Date(timestamp),
    }).returning();

    return {
      token: this.mapToEntity(result),
      code,  // Return plain text code to send via email
    };
  }

  /**
   * Verify a code and mark the token as used if valid
   */
  async verify(
    tenantId: string,
    userId: string,
    tokenType: VerificationTokenType,
    code: string
  ): Promise<{ valid: boolean; reason?: string; attemptsRemaining?: number }> {
    // Find active token
    const [token] = await db
      .select()
      .from(verificationTokens)
      .where(and(
        eq(verificationTokens.tenantId, tenantId),
        eq(verificationTokens.userId, userId),
        eq(verificationTokens.tokenType, tokenType),
        isNull(verificationTokens.usedAt),
        gt(verificationTokens.expiresAt, new Date())
      ))
      .orderBy(verificationTokens.createdAt)
      .limit(1);

    if (!token) {
      return { valid: false, reason: 'No active verification token found or token expired' };
    }

    // Check max attempts
    if (token.attempts >= token.maxAttempts) {
      return { valid: false, reason: 'Maximum verification attempts exceeded', attemptsRemaining: 0 };
    }

    // Verify code
    const codeHash = hashVerificationCode(code);
    if (codeHash !== token.codeHash) {
      // Increment attempts
      await db
        .update(verificationTokens)
        .set({ attempts: token.attempts + 1 })
        .where(eq(verificationTokens.id, token.id));

      const attemptsRemaining = token.maxAttempts - token.attempts - 1;
      return {
        valid: false,
        reason: 'Invalid verification code',
        attemptsRemaining,
      };
    }

    // Mark as used
    await db
      .update(verificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(verificationTokens.id, token.id));

    return { valid: true };
  }

  /**
   * Invalidate existing active tokens of a specific type for a user
   */
  async invalidateExisting(
    tenantId: string,
    userId: string,
    tokenType: VerificationTokenType
  ): Promise<void> {
    await db
      .update(verificationTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(verificationTokens.tenantId, tenantId),
        eq(verificationTokens.userId, userId),
        eq(verificationTokens.tokenType, tokenType),
        isNull(verificationTokens.usedAt)
      ));
  }

  /**
   * Get active token for a user (if any)
   */
  async getActiveToken(
    tenantId: string,
    userId: string,
    tokenType: VerificationTokenType
  ): Promise<VerificationToken | null> {
    const [token] = await db
      .select()
      .from(verificationTokens)
      .where(and(
        eq(verificationTokens.tenantId, tenantId),
        eq(verificationTokens.userId, userId),
        eq(verificationTokens.tokenType, tokenType),
        isNull(verificationTokens.usedAt),
        gt(verificationTokens.expiresAt, new Date())
      ))
      .orderBy(verificationTokens.createdAt)
      .limit(1);

    return token ? this.mapToEntity(token) : null;
  }

  /**
   * Count recent tokens created (for rate limiting)
   */
  async countRecentTokens(
    tenantId: string,
    userId: string,
    tokenType: VerificationTokenType,
    withinMinutes: number
  ): Promise<number> {
    const since = new Date(Date.now() - withinMinutes * 60 * 1000);

    const result = await db
      .select()
      .from(verificationTokens)
      .where(and(
        eq(verificationTokens.tenantId, tenantId),
        eq(verificationTokens.userId, userId),
        eq(verificationTokens.tokenType, tokenType),
        gt(verificationTokens.createdAt, since)
      ));

    return result.length;
  }

  /**
   * Clean up expired tokens (for scheduled job)
   */
  async cleanupExpired(olderThanDays: number = 1): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await db
      .delete(verificationTokens)
      .where(lt(verificationTokens.expiresAt, cutoff))
      .returning();

    return result.length;
  }

  private mapToEntity(row: typeof verificationTokens.$inferSelect): VerificationToken {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      tokenType: row.tokenType,
      codeHash: row.codeHash,
      expiresAt: row.expiresAt.toISOString(),
      usedAt: row.usedAt?.toISOString(),
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      ipAddress: row.ipAddress || undefined,
      userAgent: row.userAgent || undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// Export singleton instance
export const verificationTokenRepository = new VerificationTokenRepository();
