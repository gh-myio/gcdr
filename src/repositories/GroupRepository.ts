import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Group, GroupSummary, GroupMember, createDefaultHierarchy } from '../domain/entities/Group';
import { CreateGroupDTO, UpdateGroupDTO, AddMembersDTO } from '../dto/request/GroupDTO';
import { PaginatedResult } from '../shared/types';
import { IGroupRepository, ListGroupsParams } from './interfaces/IGroupRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class GroupRepository implements IGroupRepository {
  private tableName = TableNames.GROUPS;

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

    const group: Group = {
      id,
      tenantId,
      customerId,
      name: data.name,
      displayName: data.displayName || data.name,
      description: data.description,
      code: data.code,
      type: data.type,
      purposes: data.purposes,
      members,
      memberCount: members.length,
      hierarchy,
      notificationSettings: data.notificationSettings,
      tags: data.tags || [],
      metadata: data.metadata || {},
      visibleToChildCustomers: data.visibleToChildCustomers || false,
      editableByChildCustomers: data.editableByChildCustomers || false,
      status: 'ACTIVE',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: group,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    // Update parent's childGroupIds if needed
    if (data.parentGroupId) {
      await this.addChildToParent(tenantId, data.parentGroupId, id);
    }

    return group;
  }

  async getById(tenantId: string, id: string): Promise<Group | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Group) || null;
  }

  async getByCode(tenantId: string, customerId: string, code: string): Promise<Group | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-customer-code',
        KeyConditionExpression: 'customerId = :customerId AND code = :code',
        FilterExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':customerId': customerId,
          ':code': code,
          ':tenantId': tenantId,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return result.Items[0] as Group;
  }

  async update(tenantId: string, id: string, data: UpdateGroupDTO, updatedBy: string): Promise<Group> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    const fieldsToUpdate: Record<string, unknown> = {
      ...data,
      updatedAt: now(),
      updatedBy,
      version: existing.version + 1,
    };

    // Handle displayName derivation
    if (data.name && !data.displayName) {
      fieldsToUpdate.displayName = data.name;
    }

    Object.entries(fieldsToUpdate).forEach(([key, value]) => {
      if (value !== undefined) {
        updateExpressions.push(`#${key} = :${key}`);
        expressionAttributeNames[`#${key}`] = key;
        expressionAttributeValues[`:${key}`] = value;
      }
    });

    expressionAttributeValues[':currentVersion'] = existing.version;

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: { ...expressionAttributeNames, '#version': 'version' },
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Group;
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

    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );
  }

  async softDelete(tenantId: string, id: string, deletedBy: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: 'SET #status = :status, deletedAt = :deletedAt, updatedBy = :updatedBy, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'DELETED',
          ':deletedAt': now(),
          ':updatedBy': deletedBy,
          ':updatedAt': now(),
        },
      })
    );
  }

  async list(tenantId: string, params?: ListGroupsParams): Promise<PaginatedResult<GroupSummary>> {
    const limit = params?.limit || 20;
    const filterExpressions: string[] = ['#status <> :deleted'];
    const expressionAttributeValues: Record<string, unknown> = {
      ':tenantId': tenantId,
      ':deleted': 'DELETED',
    };
    const expressionAttributeNames: Record<string, string> = { '#status': 'status' };

    if (params?.customerId) {
      filterExpressions.push('customerId = :customerId');
      expressionAttributeValues[':customerId'] = params.customerId;
    }

    if (params?.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params?.purpose) {
      filterExpressions.push('contains(purposes, :purpose)');
      expressionAttributeValues[':purpose'] = params.purpose;
    }

    if (params?.status) {
      filterExpressions.push('#status = :statusFilter');
      expressionAttributeValues[':statusFilter'] = params.status;
    }

    if (params?.tag) {
      filterExpressions.push('contains(tags, :tag)');
      expressionAttributeValues[':tag'] = params.tag;
    }

    if (params?.search) {
      filterExpressions.push('(contains(#name, :search) OR contains(displayName, :search))');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':search'] = params.search;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: filterExpressions.join(' AND '),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params?.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as Group[]) || [];
    const hasMore = items.length > limit;
    const returnItems = hasMore ? items.slice(0, limit) : items;

    return {
      items: returnItems.map(this.toSummary),
      pagination: {
        hasMore,
        nextCursor: hasMore && result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
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

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: groupId },
        UpdateExpression: 'SET members = :members, memberCount = :memberCount, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
        ExpressionAttributeValues: {
          ':members': updatedMembers,
          ':memberCount': updatedMembers.length,
          ':updatedAt': timestamp,
          ':updatedBy': addedBy,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Group;
  }

  async removeMembers(tenantId: string, groupId: string, memberIds: string[], removedBy: string): Promise<Group> {
    const group = await this.getById(tenantId, groupId);
    if (!group) {
      throw new AppError('GROUP_NOT_FOUND', 'Group not found', 404);
    }

    const idsToRemove = new Set(memberIds);
    const updatedMembers = group.members.filter(m => !idsToRemove.has(m.id));

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: groupId },
        UpdateExpression: 'SET members = :members, memberCount = :memberCount, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
        ExpressionAttributeValues: {
          ':members': updatedMembers,
          ':memberCount': updatedMembers.length,
          ':updatedAt': now(),
          ':updatedBy': removedBy,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Group;
  }

  async getGroupsByMember(tenantId: string, memberId: string, memberType: 'USER' | 'DEVICE' | 'ASSET'): Promise<GroupSummary[]> {
    // Note: This requires a scan or GSI on member IDs
    // For production, consider using a separate membership table
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: '#status <> :deleted',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':deleted': 'DELETED',
        },
      })
    );

    const groups = (result.Items as Group[]) || [];

    // Filter groups that contain the member
    const matchingGroups = groups.filter(group =>
      group.members.some(m => m.id === memberId && m.type === memberType)
    );

    return matchingGroups.map(this.toSummary);
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

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: 'begins_with(hierarchy.#path, :pathPrefix) AND #status <> :deleted',
        ExpressionAttributeNames: {
          '#path': 'path',
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':pathPrefix': pathPrefix + '/',
          ':deleted': 'DELETED',
        },
      })
    );

    const groups = (result.Items as Group[]) || [];
    return groups.map(this.toSummary);
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

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: groupId },
        UpdateExpression: 'SET hierarchy = :hierarchy, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
        ExpressionAttributeValues: {
          ':hierarchy': newHierarchy,
          ':updatedAt': now(),
          ':updatedBy': movedBy,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Group;
  }

  async getByIds(tenantId: string, ids: string[]): Promise<Group[]> {
    if (ids.length === 0) {
      return [];
    }

    const keys = ids.map(id => ({ tenantId, id }));

    const result = await dynamoDb.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: keys,
          },
        },
      })
    );

    return (result.Responses?.[this.tableName] as Group[]) || [];
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
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: parentId },
        UpdateExpression: 'SET hierarchy.childGroupIds = list_append(if_not_exists(hierarchy.childGroupIds, :empty), :childId)',
        ExpressionAttributeValues: {
          ':childId': [childId],
          ':empty': [],
        },
      })
    );
  }

  private async removeChildFromParent(tenantId: string, parentId: string, childId: string): Promise<void> {
    const parent = await this.getById(tenantId, parentId);
    if (!parent || !parent.hierarchy?.childGroupIds) {
      return;
    }

    const updatedChildren = parent.hierarchy.childGroupIds.filter(id => id !== childId);

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: parentId },
        UpdateExpression: 'SET hierarchy.childGroupIds = :children',
        ExpressionAttributeValues: {
          ':children': updatedChildren,
        },
      })
    );
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
}

export const groupRepository = new GroupRepository();
