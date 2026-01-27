import { eq, and, sql, lt } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { RoleAssignment } from '../domain/entities/RoleAssignment';
import { AssignRoleDTO } from '../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../shared/types';
import { IRoleAssignmentRepository, UpdateRoleAssignmentDTO } from './interfaces/IRoleAssignmentRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { roleAssignments } = schema;

export class RoleAssignmentRepository implements IRoleAssignmentRepository {

  async create(tenantId: string, data: AssignRoleDTO, grantedBy: string): Promise<RoleAssignment> {
    // Check if same assignment already exists (same user, role, scope)
    const existingAssignments = await this.getByUserIdAndScope(tenantId, data.userId, data.scope);
    const duplicate = existingAssignments.find(
      (a) => a.roleKey === data.roleKey && a.status === 'active'
    );
    if (duplicate) {
      throw new AppError('ASSIGNMENT_EXISTS', 'User already has this role in this scope', 409);
    }

    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(roleAssignments).values({
      id,
      tenantId,
      userId: data.userId,
      roleKey: data.roleKey,
      scope: data.scope,
      status: 'active',
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      grantedBy,
      grantedAt: new Date(timestamp),
      reason: data.reason || null,
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy: grantedBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<RoleAssignment | null> {
    const [result] = await db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdateRoleAssignmentDTO, updatedBy: string): Promise<RoleAssignment> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('ASSIGNMENT_NOT_FOUND', 'Role assignment not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    if (data.status !== undefined) updateData.status = data.status;
    if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    if (data.reason !== undefined) updateData.reason = data.reason;

    const [result] = await db
      .update(roleAssignments)
      .set(updateData)
      .where(and(
        eq(roleAssignments.tenantId, tenantId),
        eq(roleAssignments.id, id),
        eq(roleAssignments.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Role assignment was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(roleAssignments)
      .where(and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.id, id)));
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<RoleAssignment>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const results = await db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.tenantId, tenantId))
      .orderBy(roleAssignments.createdAt)
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

  async getByUserId(tenantId: string, userId: string): Promise<RoleAssignment[]> {
    const results = await db
      .select()
      .from(roleAssignments)
      .where(and(
        eq(roleAssignments.tenantId, tenantId),
        eq(roleAssignments.userId, userId)
      ))
      .orderBy(roleAssignments.createdAt);

    return results.map(this.mapToEntity);
  }

  async getByUserIdAndScope(tenantId: string, userId: string, scope: string): Promise<RoleAssignment[]> {
    const results = await db
      .select()
      .from(roleAssignments)
      .where(and(
        eq(roleAssignments.tenantId, tenantId),
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.scope, scope)
      ))
      .orderBy(roleAssignments.createdAt);

    return results.map(this.mapToEntity);
  }

  async getActiveByUserId(tenantId: string, userId: string): Promise<RoleAssignment[]> {
    const results = await db
      .select()
      .from(roleAssignments)
      .where(and(
        eq(roleAssignments.tenantId, tenantId),
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.status, 'active')
      ))
      .orderBy(roleAssignments.createdAt);

    // Also filter out expired assignments
    const currentTime = now();
    const assignments = results.map(this.mapToEntity);
    return assignments.filter(
      (a) => !a.expiresAt || a.expiresAt > currentTime
    );
  }

  async getByRoleKey(tenantId: string, roleKey: string): Promise<RoleAssignment[]> {
    const results = await db
      .select()
      .from(roleAssignments)
      .where(and(
        eq(roleAssignments.tenantId, tenantId),
        eq(roleAssignments.roleKey, roleKey)
      ))
      .orderBy(roleAssignments.createdAt);

    return results.map(this.mapToEntity);
  }

  async revokeByUserId(tenantId: string, userId: string, revokedBy: string): Promise<void> {
    const assignments = await this.getActiveByUserId(tenantId, userId);

    for (const assignment of assignments) {
      await this.update(tenantId, assignment.id, { status: 'inactive' }, revokedBy);
    }
  }

  async revokeByRoleKey(tenantId: string, roleKey: string, revokedBy: string): Promise<void> {
    const assignments = await this.getByRoleKey(tenantId, roleKey);
    const activeAssignments = assignments.filter((a) => a.status === 'active');

    for (const assignment of activeAssignments) {
      await this.update(tenantId, assignment.id, { status: 'inactive' }, revokedBy);
    }
  }

  async expireOldAssignments(tenantId: string): Promise<number> {
    // This would typically be run as a scheduled job
    // Scans for active assignments that have passed their expiresAt
    const currentTime = new Date();

    const results = await db
      .select()
      .from(roleAssignments)
      .where(and(
        eq(roleAssignments.tenantId, tenantId),
        eq(roleAssignments.status, 'active'),
        lt(roleAssignments.expiresAt, currentTime)
      ));

    const expiredAssignments = results.map(this.mapToEntity);

    for (const assignment of expiredAssignments) {
      await this.update(tenantId, assignment.id, { status: 'expired' }, 'system');
    }

    return expiredAssignments.length;
  }

  private mapToEntity(row: typeof roleAssignments.$inferSelect): RoleAssignment {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      roleKey: row.roleKey,
      scope: row.scope,
      status: row.status,
      expiresAt: row.expiresAt?.toISOString(),
      grantedBy: row.grantedBy,
      grantedAt: row.grantedAt.toISOString(),
      reason: row.reason || undefined,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
    };
  }
}

// Export singleton instance
export const roleAssignmentRepository = new RoleAssignmentRepository();
