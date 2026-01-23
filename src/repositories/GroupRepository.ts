import { eq, and, ne, like, ilike, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Group, GroupSummary, GroupMember, createDefaultHierarchy } from '../domain/entities/Group';
import { CreateGroupDTO, UpdateGroupDTO, AddMembersDTO } from '../dto/request/GroupDTO';
import { PaginatedResult } from '../shared/types';
import { IGroupRepository, ListGroupsParams } from './interfaces/IGroupRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { groups } = schema;

export class GroupRepository implements IGroupRepository {

  async create(tenantId: string, customerId: string, data: CreateGroupDTO, createdBy: string): Promise<Group> {
    // Check if code already exists (if provided)
    if (data.code) {
      const existing = await this.getByCode(tenantId, customerId, data.code);
      if (existing) {
        throw new AppError('GROUP_CODE_EXISTS', `Group with code '${data.code}' already exists`, 409);
      }
    }

    const id = generateId();
    const timestamp = now();

    // Build hierarchy if parent is specified
    let hierarchy = createDefaultHierarchy();
    if (data.parentGroupId) {
      const parent = await this.getById(tenantId, data.parentGroupId);
      if (!parent) {
        throw new AppError('PARENT_GROUP_NOT_FOUND', 'Parent group not found', 404);
      }
      if (parent.customerId !== customerId) {
        throw new AppError('PARENT_GROUP_INVALID', 'Parent group belongs to different customer', 400);
      }
      hierarchy = {
        parentGroupId: data.parentGroupId,
        childGroupIds: [],
        path: parent.hierarchy?.path ? `${parent.hierarchy.path}/${id}` : `/${parent.id}/${id}`,
        depth: (parent.hierarchy?.depth || 0) + 1,
      };
    } else {
      hierarchy.path = `/${id}`;
    }

    // Build members array with metadata
    const members: GroupMember[] = (data.members || []).map(m => ({
      id: m.id,
      type: m.type,
      addedAt: timestamp,
      addedBy: createdBy,
      metadata: m.metadata,
    }));

    const [result] = await db.insert(groups).values({
      id,
      tenantId,
      customerId,
      name: data.name,
      displayName: data.displayName || data.name,
      description: data.description || null,
      code: data.code || null,
      type: data.type,
      purposes: data.purposes || [],
      members,
      memberCount: members.length,
      hierarchy,
      notificationSettings: data.notificationSettings || null,
      tags: data.tags || [],
      metadata: data.metadata || {},
      visibleToChildCustomers: data.visibleToChildCustomers || false,
      editableByChildCustomers: data.editableByChildCustomers || false,
      status: 'ACTIVE',
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    // Update parent's childGroupIds if needed
    if (data.parentGroupId) {
      await this.addChildToParent(tenantId, data.parentGroupId, id);
    }

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Group | null> {
    const [result] = await db
      .select()
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByCode(tenantId: string, customerId: string, code: string): Promise<Group | null> {
    const [result] = await db
      .select()
      .from(groups)
      .where(and(
        eq(groups.tenantId, tenantId),
        eq(groups.customerId, customerId),
        eq(groups.code, code)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdateGroupDTO, updatedBy: string): Promise<Group> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.purposes !== undefined) updateData.purposes = data.purposes;
    if (data.notificationSettings !== undefined) updateData.notificationSettings = data.notificationSettings;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.metadata !== undefined) updateData.metadata = { ...existing.metadata, ...data.metadata };
    if (data.visibleToChildCustomers !== undefined) updateData.visibleToChildCustomers = data.visibleToChildCustomers;
    if (data.editableByChildCustomers !== undefined) updateData.editableByChildCustomers = data.editableByChildCustomers;

    // Handle displayName derivation
    if (data.name && !data.displayName) {
      updateData.displayName = data.name;
    }

    const [result] = await db
      .update(groups)
      .set(updateData)
      .where(and(
        eq(groups.tenantId, tenantId),
        eq(groups.id, id),
        eq(groups.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Group was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    // Check for child groups
    if (existing.hierarchy?.childGroupIds && existing.hierarchy.childGroupIds.length > 0) {
      throw new AppError('GROUP_HAS_CHILDREN', 'Cannot delete group with child groups', 400);
    }

    // Remove from parent's childGroupIds
    if (existing.hierarchy?.parentGroupId) {
      await this.removeChildFromParent(tenantId, existing.hierarchy.parentGroupId, id);
    }

    await db
      .delete(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)));
  }

  async softDelete(tenantId: string, id: string, deletedBy: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    await db
      .update(groups)
      .set({
        status: 'DELETED',
        deletedAt: new Date(),
        updatedBy: deletedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, id)));
  }

  async list(tenantId: string, params?: ListGroupsParams): Promise<PaginatedResult<GroupSummary>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [
      eq(groups.tenantId, tenantId),
      ne(groups.status, 'DELETED'),
    ];

    if (params?.customerId) {
      conditions.push(eq(groups.customerId, params.customerId));
    }

    if (params?.type) {
      conditions.push(eq(groups.type, params.type));
    }

    if (params?.status) {
      conditions.push(eq(groups.status, params.status));
    }

    // Note: purpose and tag filtering on JSONB arrays would require raw SQL
    // For simplicity, we'll filter in memory for now
    // In production, consider using jsonb_exists_any or GIN indexes

    if (params?.search) {
      conditions.push(
        sql`(${groups.name} ILIKE ${`%${params.search}%`} OR ${groups.displayName} ILIKE ${`%${params.search}%`})`
      );
    }

    const results = await db
      .select()
      .from(groups)
      .where(and(...conditions))
      .orderBy(groups.name)
      .limit(limit + 1)
      .offset(offset);

    let filteredResults = results;

    // Filter by purpose if specified
    if (params?.purpose) {
      filteredResults = filteredResults.filter(g => {
        const purposes = g.purposes as string[];
        return purposes && purposes.includes(params.purpose!);
      });
    }

    // Filter by tag if specified
    if (params?.tag) {
      filteredResults = filteredResults.filter(g => {
        const tags = g.tags as string[];
        return tags && tags.includes(params.tag!);
      });
    }

    const hasMore = filteredResults.length > limit;
    const items = hasMore ? filteredResults.slice(0, limit) : filteredResults;

    return {
      items: items.map(r => this.toSummary(this.mapToEntity(r))),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async listByCustomer(tenantId: string, customerId: string, params?: ListGroupsParams): Promise<PaginatedResult<GroupSummary>> {
    return this.list(tenantId, { ...params, customerId });
  }

  async addMembers(tenantId: string, groupId: string, members: AddMembersDTO['members'], addedBy: string): Promise<Group> {
    const group = await this.getById(tenantId, groupId);
    if (!group) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    const timestamp = now();
    const existingMemberIds = new Set(group.members.map(m => m.id));

    // Filter out duplicates and validate type
    const newMembers: GroupMember[] = [];
    for (const member of members) {
      if (existingMemberIds.has(member.id)) {
        continue; // Skip duplicates
      }

      // Validate member type against group type
      if (group.type !== 'MIXED' && group.type !== member.type) {
        throw new AppError(
          'INVALID_MEMBER_TYPE',
          `Group of type '${group.type}' cannot contain members of type '${member.type}'`,
          400
        );
      }

      newMembers.push({
        id: member.id,
        type: member.type,
        addedAt: timestamp,
        addedBy,
        metadata: member.metadata,
      });
    }

    if (newMembers.length === 0) {
      return group; // No new members to add
    }

    const updatedMembers = [...group.members, ...newMembers];

    const [result] = await db
      .update(groups)
      .set({
        members: updatedMembers,
        memberCount: updatedMembers.length,
        updatedAt: new Date(timestamp),
        updatedBy: addedBy,
        version: group.version + 1,
      })
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, groupId)))
      .returning();

    return this.mapToEntity(result);
  }

  async removeMembers(tenantId: string, groupId: string, memberIds: string[], removedBy: string): Promise<Group> {
    const group = await this.getById(tenantId, groupId);
    if (!group) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    const idsToRemove = new Set(memberIds);
    const updatedMembers = group.members.filter(m => !idsToRemove.has(m.id));

    const [result] = await db
      .update(groups)
      .set({
        members: updatedMembers,
        memberCount: updatedMembers.length,
        updatedAt: new Date(),
        updatedBy: removedBy,
        version: group.version + 1,
      })
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, groupId)))
      .returning();

    return this.mapToEntity(result);
  }

  async getGroupsByMember(tenantId: string, memberId: string, memberType: 'USER' | 'DEVICE' | 'ASSET'): Promise<GroupSummary[]> {
    // Query all groups for tenant and filter in memory
    // For production, consider using jsonb operators with GIN indexes
    const results = await db
      .select()
      .from(groups)
      .where(and(
        eq(groups.tenantId, tenantId),
        ne(groups.status, 'DELETED')
      ));

    // Filter groups that contain the member
    const matchingGroups = results.filter(group => {
      const members = group.members as GroupMember[];
      return members && members.some(m => m.id === memberId && m.type === memberType);
    });

    return matchingGroups.map(g => this.toSummary(this.mapToEntity(g)));
  }

  async getChildren(tenantId: string, parentGroupId: string): Promise<GroupSummary[]> {
    const parent = await this.getById(tenantId, parentGroupId);
    if (!parent) {
      throw new AppError('GROUP_NOT_FOUND', 'Parent group not found', 404);
    }

    if (!parent.hierarchy?.childGroupIds || parent.hierarchy.childGroupIds.length === 0) {
      return [];
    }

    const children = await this.getByIds(tenantId, parent.hierarchy.childGroupIds);
    return children.map(this.toSummary);
  }

  async getDescendants(tenantId: string, parentGroupId: string): Promise<GroupSummary[]> {
    const parent = await this.getById(tenantId, parentGroupId);
    if (!parent) {
      throw new AppError('GROUP_NOT_FOUND', 'Parent group not found', 404);
    }

    // Use path prefix to find all descendants
    const pathPrefix = parent.hierarchy?.path || `/${parentGroupId}`;

    const results = await db
      .select()
      .from(groups)
      .where(and(
        eq(groups.tenantId, tenantId),
        ne(groups.status, 'DELETED'),
        sql`(${groups.hierarchy}->>'path')::text LIKE ${pathPrefix + '/%'}`
      ));

    return results.map(g => this.toSummary(this.mapToEntity(g)));
  }

  async moveGroup(tenantId: string, groupId: string, newParentGroupId: string | null, movedBy: string): Promise<Group> {
    const group = await this.getById(tenantId, groupId);
    if (!group) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    const oldParentId = group.hierarchy?.parentGroupId;

    // Remove from old parent
    if (oldParentId) {
      await this.removeChildFromParent(tenantId, oldParentId, groupId);
    }

    // Build new hierarchy
    let newHierarchy = createDefaultHierarchy();
    if (newParentGroupId) {
      const newParent = await this.getById(tenantId, newParentGroupId);
      if (!newParent) {
        throw new AppError('PARENT_GROUP_NOT_FOUND', 'New parent group not found', 404);
      }
      if (newParent.customerId !== group.customerId) {
        throw new AppError('PARENT_GROUP_INVALID', 'Parent group belongs to different customer', 400);
      }

      // Prevent circular reference
      if (newParent.hierarchy?.path?.includes(`/${groupId}/`)) {
        throw new AppError('CIRCULAR_REFERENCE', 'Cannot move group under its own descendant', 400);
      }

      newHierarchy = {
        parentGroupId: newParentGroupId,
        childGroupIds: group.hierarchy?.childGroupIds || [],
        path: `${newParent.hierarchy?.path}/${groupId}`,
        depth: (newParent.hierarchy?.depth || 0) + 1,
      };

      // Add to new parent
      await this.addChildToParent(tenantId, newParentGroupId, groupId);
    } else {
      newHierarchy = {
        childGroupIds: group.hierarchy?.childGroupIds || [],
        path: `/${groupId}`,
        depth: 0,
      };
    }

    const [result] = await db
      .update(groups)
      .set({
        hierarchy: newHierarchy,
        updatedAt: new Date(),
        updatedBy: movedBy,
        version: group.version + 1,
      })
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, groupId)))
      .returning();

    return this.mapToEntity(result);
  }

  async getByIds(tenantId: string, ids: string[]): Promise<Group[]> {
    if (ids.length === 0) {
      return [];
    }

    const results = await db
      .select()
      .from(groups)
      .where(and(
        eq(groups.tenantId, tenantId),
        inArray(groups.id, ids)
      ));

    return results.map(this.mapToEntity);
  }

  async getMembersByType(tenantId: string, groupId: string, memberType: 'USER' | 'DEVICE' | 'ASSET'): Promise<string[]> {
    const group = await this.getById(tenantId, groupId);
    if (!group) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    return group.members
      .filter(m => m.type === memberType)
      .map(m => m.id);
  }

  // Helper methods

  private async addChildToParent(tenantId: string, parentId: string, childId: string): Promise<void> {
    const parent = await this.getById(tenantId, parentId);
    if (!parent) return;

    const childGroupIds = parent.hierarchy?.childGroupIds || [];
    if (!childGroupIds.includes(childId)) {
      childGroupIds.push(childId);
    }

    await db
      .update(groups)
      .set({
        hierarchy: {
          ...parent.hierarchy,
          childGroupIds,
        },
      })
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, parentId)));
  }

  private async removeChildFromParent(tenantId: string, parentId: string, childId: string): Promise<void> {
    const parent = await this.getById(tenantId, parentId);
    if (!parent || !parent.hierarchy?.childGroupIds) {
      return;
    }

    const updatedChildren = parent.hierarchy.childGroupIds.filter(id => id !== childId);

    await db
      .update(groups)
      .set({
        hierarchy: {
          ...parent.hierarchy,
          childGroupIds: updatedChildren,
        },
      })
      .where(and(eq(groups.tenantId, tenantId), eq(groups.id, parentId)));
  }

  private toSummary(group: Group): GroupSummary {
    return {
      id: group.id,
      tenantId: group.tenantId,
      customerId: group.customerId,
      name: group.name,
      displayName: group.displayName,
      type: group.type,
      purposes: group.purposes,
      memberCount: group.memberCount,
      tags: group.tags,
      status: group.status,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  private mapToEntity(row: typeof groups.$inferSelect): Group {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      name: row.name,
      displayName: row.displayName,
      description: row.description || undefined,
      code: row.code || undefined,
      type: row.type,
      purposes: row.purposes as Group['purposes'],
      members: row.members as GroupMember[],
      memberCount: row.memberCount,
      hierarchy: row.hierarchy as Group['hierarchy'],
      notificationSettings: row.notificationSettings as Group['notificationSettings'],
      tags: row.tags as string[],
      metadata: row.metadata as Record<string, unknown>,
      visibleToChildCustomers: row.visibleToChildCustomers,
      editableByChildCustomers: row.editableByChildCustomers,
      status: row.status,
      deletedAt: row.deletedAt?.toISOString(),
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
    };
  }
}

// Export singleton instance
export const groupRepository = new GroupRepository();
