import { eq, and, ilike, sql, isNull, or, gt } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import {
  MaintenanceGroup,
  UserMaintenanceGroup,
  MaintenanceGroupMember,
  MaintenanceGroupWithMembers,
} from '../domain/entities/MaintenanceGroup';
import {
  CreateMaintenanceGroupDTO,
  UpdateMaintenanceGroupDTO,
} from '../dto/request/MaintenanceGroupDTO';
import { PaginatedResult } from '../shared/types';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { maintenanceGroups, userMaintenanceGroups, users } = schema;

export interface ListMaintenanceGroupsParams {
  customerId?: string;
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export class MaintenanceGroupRepository {

  async create(tenantId: string, data: CreateMaintenanceGroupDTO, createdBy: string): Promise<MaintenanceGroup> {
    // Check if key already exists
    const existing = await this.getByKey(tenantId, data.key);
    if (existing) {
      throw new AppError('MAINTENANCE_GROUP_KEY_EXISTS', `Maintenance group with key '${data.key}' already exists`, 409);
    }

    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(maintenanceGroups).values({
      id,
      tenantId,
      key: data.key,
      name: data.name,
      description: data.description || null,
      customerId: data.customerId || null,
      memberCount: 0,
      isActive: true,
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<MaintenanceGroup | null> {
    const [result] = await db
      .select()
      .from(maintenanceGroups)
      .where(and(eq(maintenanceGroups.tenantId, tenantId), eq(maintenanceGroups.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByKey(tenantId: string, key: string): Promise<MaintenanceGroup | null> {
    const [result] = await db
      .select()
      .from(maintenanceGroups)
      .where(and(eq(maintenanceGroups.tenantId, tenantId), eq(maintenanceGroups.key, key)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByIdWithMembers(tenantId: string, id: string): Promise<MaintenanceGroupWithMembers | null> {
    const group = await this.getById(tenantId, id);
    if (!group) return null;

    const members = await this.getMembers(tenantId, id);
    return { ...group, members };
  }

  async update(tenantId: string, id: string, data: UpdateMaintenanceGroupDTO, updatedBy: string): Promise<MaintenanceGroup> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('MAINTENANCE_GROUP_NOT_FOUND', 'Maintenance group not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.customerId !== undefined) updateData.customerId = data.customerId;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const [result] = await db
      .update(maintenanceGroups)
      .set(updateData)
      .where(and(
        eq(maintenanceGroups.tenantId, tenantId),
        eq(maintenanceGroups.id, id),
        eq(maintenanceGroups.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Maintenance group was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('MAINTENANCE_GROUP_NOT_FOUND', 'Maintenance group not found', 404);
    }

    // Delete all user assignments first
    await db
      .delete(userMaintenanceGroups)
      .where(and(
        eq(userMaintenanceGroups.tenantId, tenantId),
        eq(userMaintenanceGroups.groupId, id)
      ));

    // Delete the group
    await db
      .delete(maintenanceGroups)
      .where(and(eq(maintenanceGroups.tenantId, tenantId), eq(maintenanceGroups.id, id)));
  }

  async list(tenantId: string, params?: ListMaintenanceGroupsParams): Promise<PaginatedResult<MaintenanceGroup>> {
    const limit = params?.limit || 20;
    const offset = params?.offset || 0;

    const conditions = [eq(maintenanceGroups.tenantId, tenantId)];

    if (params?.customerId) {
      conditions.push(eq(maintenanceGroups.customerId, params.customerId));
    }

    if (params?.isActive !== undefined) {
      conditions.push(eq(maintenanceGroups.isActive, params.isActive));
    }

    if (params?.search) {
      conditions.push(
        or(
          ilike(maintenanceGroups.name, `%${params.search}%`),
          ilike(maintenanceGroups.key, `%${params.search}%`)
        )!
      );
    }

    const results = await db
      .select()
      .from(maintenanceGroups)
      .where(and(...conditions))
      .orderBy(maintenanceGroups.name)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(r => this.mapToEntity(r)),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  // =========================================================================
  // Member Management
  // =========================================================================

  async addMember(tenantId: string, groupId: string, userId: string, assignedBy: string, expiresAt?: string): Promise<void> {
    const group = await this.getById(tenantId, groupId);
    if (!group) {
      throw new AppError('MAINTENANCE_GROUP_NOT_FOUND', 'Maintenance group not found', 404);
    }

    // Check if already a member
    const existing = await this.getMembership(tenantId, userId, groupId);
    if (existing) {
      throw new AppError('ALREADY_MEMBER', 'User is already a member of this group', 409);
    }

    const id = generateId();
    const timestamp = now();

    await db.insert(userMaintenanceGroups).values({
      id,
      tenantId,
      userId,
      groupId,
      assignedAt: new Date(timestamp),
      assignedBy,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdAt: new Date(timestamp),
    });

    // Update member count
    await this.updateMemberCount(tenantId, groupId);
  }

  async addMembers(tenantId: string, groupId: string, userIds: string[], assignedBy: string, expiresAt?: string): Promise<void> {
    const group = await this.getById(tenantId, groupId);
    if (!group) {
      throw new AppError('MAINTENANCE_GROUP_NOT_FOUND', 'Maintenance group not found', 404);
    }

    const timestamp = now();

    for (const userId of userIds) {
      const existing = await this.getMembership(tenantId, userId, groupId);
      if (!existing) {
        const id = generateId();
        await db.insert(userMaintenanceGroups).values({
          id,
          tenantId,
          userId,
          groupId,
          assignedAt: new Date(timestamp),
          assignedBy,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          createdAt: new Date(timestamp),
        });
      }
    }

    await this.updateMemberCount(tenantId, groupId);
  }

  async removeMember(tenantId: string, groupId: string, userId: string): Promise<void> {
    await db
      .delete(userMaintenanceGroups)
      .where(and(
        eq(userMaintenanceGroups.tenantId, tenantId),
        eq(userMaintenanceGroups.groupId, groupId),
        eq(userMaintenanceGroups.userId, userId)
      ));

    await this.updateMemberCount(tenantId, groupId);
  }

  async removeMembers(tenantId: string, groupId: string, userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      await db
        .delete(userMaintenanceGroups)
        .where(and(
          eq(userMaintenanceGroups.tenantId, tenantId),
          eq(userMaintenanceGroups.groupId, groupId),
          eq(userMaintenanceGroups.userId, userId)
        ));
    }

    await this.updateMemberCount(tenantId, groupId);
  }

  async getMembers(tenantId: string, groupId: string, includeExpired = false): Promise<MaintenanceGroupMember[]> {
    const conditions = [
      eq(userMaintenanceGroups.tenantId, tenantId),
      eq(userMaintenanceGroups.groupId, groupId),
    ];

    if (!includeExpired) {
      conditions.push(
        or(
          isNull(userMaintenanceGroups.expiresAt),
          gt(userMaintenanceGroups.expiresAt, new Date())
        )!
      );
    }

    const results = await db
      .select({
        userId: userMaintenanceGroups.userId,
        userEmail: users.email,
        profile: users.profile,
        assignedAt: userMaintenanceGroups.assignedAt,
        assignedBy: userMaintenanceGroups.assignedBy,
        expiresAt: userMaintenanceGroups.expiresAt,
      })
      .from(userMaintenanceGroups)
      .innerJoin(users, eq(users.id, userMaintenanceGroups.userId))
      .where(and(...conditions))
      .orderBy(userMaintenanceGroups.assignedAt);

    return results.map(r => ({
      userId: r.userId,
      userEmail: r.userEmail,
      userName: (r.profile as { firstName?: string; lastName?: string })?.firstName
        ? `${(r.profile as { firstName?: string }).firstName} ${(r.profile as { lastName?: string }).lastName || ''}`.trim()
        : undefined,
      assignedAt: r.assignedAt.toISOString(),
      assignedBy: r.assignedBy || undefined,
      expiresAt: r.expiresAt?.toISOString(),
    }));
  }

  async getMembership(tenantId: string, userId: string, groupId: string): Promise<UserMaintenanceGroup | null> {
    const [result] = await db
      .select()
      .from(userMaintenanceGroups)
      .where(and(
        eq(userMaintenanceGroups.tenantId, tenantId),
        eq(userMaintenanceGroups.userId, userId),
        eq(userMaintenanceGroups.groupId, groupId)
      ))
      .limit(1);

    return result ? this.mapMembershipToEntity(result) : null;
  }

  async getUserGroups(tenantId: string, userId: string, includeExpired = false): Promise<MaintenanceGroup[]> {
    const conditions = [
      eq(userMaintenanceGroups.tenantId, tenantId),
      eq(userMaintenanceGroups.userId, userId),
    ];

    if (!includeExpired) {
      conditions.push(
        or(
          isNull(userMaintenanceGroups.expiresAt),
          gt(userMaintenanceGroups.expiresAt, new Date())
        )!
      );
    }

    const results = await db
      .select({
        group: maintenanceGroups,
      })
      .from(userMaintenanceGroups)
      .innerJoin(maintenanceGroups, eq(maintenanceGroups.id, userMaintenanceGroups.groupId))
      .where(and(...conditions));

    return results.map(r => this.mapToEntity(r.group));
  }

  async getUserPrimaryGroup(tenantId: string, userId: string): Promise<MaintenanceGroup | null> {
    const groups = await this.getUserGroups(tenantId, userId);
    return groups.length > 0 ? groups[0] : null;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private async updateMemberCount(tenantId: string, groupId: string): Promise<void> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userMaintenanceGroups)
      .where(and(
        eq(userMaintenanceGroups.tenantId, tenantId),
        eq(userMaintenanceGroups.groupId, groupId),
        or(
          isNull(userMaintenanceGroups.expiresAt),
          gt(userMaintenanceGroups.expiresAt, new Date())
        )
      ));

    const count = result[0]?.count || 0;

    await db
      .update(maintenanceGroups)
      .set({ memberCount: count, updatedAt: new Date() })
      .where(and(
        eq(maintenanceGroups.tenantId, tenantId),
        eq(maintenanceGroups.id, groupId)
      ));
  }

  private mapToEntity(row: typeof maintenanceGroups.$inferSelect): MaintenanceGroup {
    return {
      id: row.id,
      tenantId: row.tenantId,
      key: row.key,
      name: row.name,
      description: row.description || undefined,
      customerId: row.customerId || undefined,
      memberCount: row.memberCount,
      isActive: row.isActive,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
    };
  }

  private mapMembershipToEntity(row: typeof userMaintenanceGroups.$inferSelect): UserMaintenanceGroup {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      groupId: row.groupId,
      assignedAt: row.assignedAt.toISOString(),
      assignedBy: row.assignedBy || undefined,
      expiresAt: row.expiresAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// Export singleton instance
export const maintenanceGroupRepository = new MaintenanceGroupRepository();
