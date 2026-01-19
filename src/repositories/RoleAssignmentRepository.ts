import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { RoleAssignment } from '../domain/entities/RoleAssignment';
import { AssignRoleDTO } from '../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../shared/types';
import { IRoleAssignmentRepository, UpdateRoleAssignmentDTO } from './interfaces/IRoleAssignmentRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class RoleAssignmentRepository implements IRoleAssignmentRepository {
  private tableName = TableNames.ROLE_ASSIGNMENTS;

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

    const assignment: RoleAssignment = {
      id,
      tenantId,
      userId: data.userId,
      roleKey: data.roleKey,
      scope: data.scope,
      status: 'active',
      expiresAt: data.expiresAt,
      grantedBy,
      grantedAt: timestamp,
      reason: data.reason,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: grantedBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: assignment,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return assignment;
  }

  async getById(tenantId: string, id: string): Promise<RoleAssignment | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as RoleAssignment) || null;
  }

  async update(tenantId: string, id: string, data: UpdateRoleAssignmentDTO, updatedBy: string): Promise<RoleAssignment> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('ASSIGNMENT_NOT_FOUND', 'Role assignment not found', 404);
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

    return result.Attributes as RoleAssignment;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<RoleAssignment>> {
    const limit = params?.limit || 20;

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
        Limit: limit + 1,
        ExclusiveStartKey: params?.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as RoleAssignment[]) || [];
    const hasMore = items.length > limit;
    const returnItems = hasMore ? items.slice(0, limit) : items;

    return {
      items: returnItems,
      pagination: {
        hasMore,
        nextCursor: hasMore && result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
      },
    };
  }

  async getByUserId(tenantId: string, userId: string): Promise<RoleAssignment[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-user',
        KeyConditionExpression: 'tenantId = :tenantId AND userId = :userId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':userId': userId,
        },
      })
    );

    return (result.Items as RoleAssignment[]) || [];
  }

  async getByUserIdAndScope(tenantId: string, userId: string, scope: string): Promise<RoleAssignment[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-user',
        KeyConditionExpression: 'tenantId = :tenantId AND userId = :userId',
        FilterExpression: '#scope = :scope',
        ExpressionAttributeNames: {
          '#scope': 'scope',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':userId': userId,
          ':scope': scope,
        },
      })
    );

    return (result.Items as RoleAssignment[]) || [];
  }

  async getActiveByUserId(tenantId: string, userId: string): Promise<RoleAssignment[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-user',
        KeyConditionExpression: 'tenantId = :tenantId AND userId = :userId',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':userId': userId,
          ':status': 'active',
        },
      })
    );

    // Also filter out expired assignments
    const assignments = (result.Items as RoleAssignment[]) || [];
    const currentTime = now();
    return assignments.filter(
      (a) => !a.expiresAt || a.expiresAt > currentTime
    );
  }

  async getByRoleKey(tenantId: string, roleKey: string): Promise<RoleAssignment[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-role',
        KeyConditionExpression: 'tenantId = :tenantId AND roleKey = :roleKey',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':roleKey': roleKey,
        },
      })
    );

    return (result.Items as RoleAssignment[]) || [];
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
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: '#status = :status AND expiresAt < :now',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':status': 'active',
          ':now': now(),
        },
      })
    );

    const expiredAssignments = (result.Items as RoleAssignment[]) || [];

    for (const assignment of expiredAssignments) {
      await this.update(tenantId, assignment.id, { status: 'expired' }, 'system');
    }

    return expiredAssignments.length;
  }
}
