import { eq, and, ilike, or, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import {
  User,
  UserStatus,
  createDefaultPreferences,
  createDefaultSecurity,
  createDefaultProfile,
} from '../domain/entities/User';
import { CreateUserDTO, UpdateUserDTO, ListUsersDTO } from '../dto/request/UserDTO';
import { PaginatedResult } from '../shared/types';
import { IUserRepository } from './interfaces/IUserRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { users } = schema;

export class UserRepository implements IUserRepository {

  async create(tenantId: string, data: CreateUserDTO, createdBy: string): Promise<User> {
    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(users).values({
      id,
      tenantId,
      customerId: data.customerId,
      partnerId: data.partnerId,
      email: data.email.toLowerCase(),
      emailVerified: false,
      username: data.username,
      type: data.type,
      status: 'PENDING_VERIFICATION',
      profile: data.profile
        ? { ...createDefaultProfile(data.profile.firstName, data.profile.lastName), ...data.profile }
        : createDefaultProfile('', ''),
      security: createDefaultSecurity(),
      preferences: data.preferences
        ? { ...createDefaultPreferences(), ...data.preferences }
        : createDefaultPreferences(),
      activeSessions: 0,
      invitedBy: createdBy,
      invitedAt: new Date(timestamp),
      tags: data.tags || [],
      metadata: data.metadata || {},
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<User | null> {
    const [result] = await db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByEmail(tenantId: string, email: string): Promise<User | null> {
    const [result] = await db
      .select()
      .from(users)
      .where(and(
        eq(users.tenantId, tenantId),
        eq(users.email, email.toLowerCase())
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByUsername(tenantId: string, username: string): Promise<User | null> {
    const [result] = await db
      .select()
      .from(users)
      .where(and(
        eq(users.tenantId, tenantId),
        eq(users.username, username)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdateUserDTO, updatedBy: string): Promise<User> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    if (data.username !== undefined) updateData.username = data.username;
    if (data.profile) updateData.profile = { ...existing.profile, ...data.profile };
    if (data.preferences) updateData.preferences = { ...existing.preferences, ...data.preferences };
    if (data.tags) updateData.tags = data.tags;
    if (data.metadata) updateData.metadata = { ...existing.metadata, ...data.metadata };

    const [result] = await db
      .update(users)
      .set(updateData)
      .where(and(
        eq(users.tenantId, tenantId),
        eq(users.id, id),
        eq(users.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'User was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async list(tenantId: string, params: ListUsersDTO): Promise<PaginatedResult<User>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(users.tenantId, tenantId)];

    if (params.customerId) {
      conditions.push(eq(users.customerId, params.customerId));
    }

    if (params.partnerId) {
      conditions.push(eq(users.partnerId, params.partnerId));
    }

    if (params.type) {
      conditions.push(eq(users.type, params.type));
    }

    if (params.status) {
      conditions.push(eq(users.status, params.status));
    }

    // Search is more complex - needs to search in email and profile fields
    // For now, we'll search in email only with Drizzle
    if (params.search) {
      conditions.push(ilike(users.email, `%${params.search.toLowerCase()}%`));
    }

    const results = await db
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(users.createdAt)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<User[]> {
    const results = await db
      .select()
      .from(users)
      .where(and(
        eq(users.tenantId, tenantId),
        eq(users.customerId, customerId)
      ))
      .orderBy(users.email);

    return results.map(this.mapToEntity);
  }

  async listByPartner(tenantId: string, partnerId: string): Promise<User[]> {
    const results = await db
      .select()
      .from(users)
      .where(and(
        eq(users.tenantId, tenantId),
        eq(users.partnerId, partnerId)
      ))
      .orderBy(users.email);

    return results.map(this.mapToEntity);
  }

  async updateStatus(tenantId: string, id: string, status: UserStatus, updatedBy: string, reason?: string): Promise<User> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const timestamp = now();
    const metadata = reason
      ? { ...existing.metadata, lastStatusChangeReason: reason, lastStatusChangeAt: timestamp }
      : existing.metadata;

    const [result] = await db
      .update(users)
      .set({
        status,
        metadata,
        updatedAt: new Date(timestamp),
        updatedBy,
        version: existing.version + 1,
      })
      .where(and(
        eq(users.tenantId, tenantId),
        eq(users.id, id),
        eq(users.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'User was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async updatePassword(tenantId: string, id: string, passwordHash: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const timestamp = now();
    const security = {
      ...existing.security,
      passwordHash,
      passwordChangedAt: timestamp,
    };

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(timestamp),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async setPasswordResetToken(tenantId: string, id: string, token: string, expiresAt: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const security = {
      ...existing.security,
      passwordResetToken: token,
      passwordResetExpiresAt: expiresAt,
    };

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async clearPasswordResetToken(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const security = { ...existing.security };
    delete security.passwordResetToken;
    delete security.passwordResetExpiresAt;

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async setEmailVerificationToken(tenantId: string, id: string, token: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const security = {
      ...existing.security,
      emailVerificationToken: token,
    };

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async verifyEmail(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const timestamp = now();
    const security = { ...existing.security, emailVerifiedAt: timestamp };
    delete security.emailVerificationToken;

    await db
      .update(users)
      .set({
        emailVerified: true,
        security,
        status: 'ACTIVE',
        updatedAt: new Date(timestamp),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async incrementFailedLoginAttempts(tenantId: string, id: string): Promise<number> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const newAttempts = (existing.security.failedLoginAttempts || 0) + 1;
    const security = {
      ...existing.security,
      failedLoginAttempts: newAttempts,
    };

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));

    return newAttempts;
  }

  async resetFailedLoginAttempts(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const security = {
      ...existing.security,
      failedLoginAttempts: 0,
    };

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async lockUser(tenantId: string, id: string, until: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const security = {
      ...existing.security,
      lockedUntil: until,
    };

    await db
      .update(users)
      .set({
        security,
        status: 'LOCKED',
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async unlockUser(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const security = { ...existing.security, failedLoginAttempts: 0 };
    delete security.lockedUntil;

    await db
      .update(users)
      .set({
        security,
        status: 'ACTIVE',
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async enableMfa(tenantId: string, id: string, method: string, secret: string, backupCodes: string[]): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const security = {
      ...existing.security,
      mfaEnabled: true,
      mfaMethod: method,
      mfaSecret: secret,
      mfaBackupCodes: backupCodes,
    };

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async disableMfa(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const security = { ...existing.security, mfaEnabled: false };
    delete security.mfaMethod;
    delete security.mfaSecret;
    delete security.mfaBackupCodes;

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async recordLogin(tenantId: string, id: string, ip: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    const timestamp = now();
    const security = {
      ...existing.security,
      lastLoginAt: timestamp,
      lastLoginIp: ip,
      failedLoginAttempts: 0,
    };

    await db
      .update(users)
      .set({
        security,
        updatedAt: new Date(timestamp),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async updateSessionCount(tenantId: string, id: string, count: number): Promise<void> {
    await db
      .update(users)
      .set({
        activeSessions: count,
        updatedAt: new Date(),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  async setInvitationAccepted(tenantId: string, id: string): Promise<void> {
    const timestamp = now();

    await db
      .update(users)
      .set({
        invitationAcceptedAt: new Date(timestamp),
        status: 'ACTIVE',
        updatedAt: new Date(timestamp),
      })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  }

  private mapToEntity(row: typeof users.$inferSelect): User {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId || undefined,
      partnerId: row.partnerId || undefined,
      email: row.email,
      emailVerified: row.emailVerified,
      username: row.username || undefined,
      type: row.type,
      status: row.status,
      profile: row.profile as User['profile'],
      security: row.security as User['security'],
      preferences: row.preferences as User['preferences'],
      activeSessions: row.activeSessions,
      invitedBy: row.invitedBy || undefined,
      invitedAt: row.invitedAt?.toISOString(),
      invitationAcceptedAt: row.invitationAcceptedAt?.toISOString(),
      tags: row.tags as string[],
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
      version: row.version,
    };
  }
}

// Export singleton instance
export const userRepository = new UserRepository();
