import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Role } from '../domain/entities/Role';
import { CreateRoleDTO, UpdateRoleDTO } from '../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../shared/types';
import { IRoleRepository, ListRolesParams } from './interfaces/IRoleRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class RoleRepository implements IRoleRepository {
  private tableName = TableNames.ROLES;

  async create(tenantId: string, data: CreateRoleDTO, createdBy: string): Promise<Role> {
    // Check if key already exists
    const existing = await this.getByKey(tenantId, data.key);
    if (existing) {
      throw new AppError('ROLE_KEY_EXISTS', `Role with key '${data.key}' already exists`, 409);
    }

    const id = generateId();
    const timestamp = now();

    const role: Role = {
      id,
      tenantId,
      key: data.key,
      displayName: data.displayName,
      description: data.description || '',
      policies: data.policies,
      tags: data.tags || [],
      riskLevel: data.riskLevel || 'low',
      isSystem: false,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: role,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return role;
  }

  async getById(tenantId: string, id: string): Promise<Role | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Role) || null;
  }

  async getByKey(tenantId: string, key: string): Promise<Role | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-key',
        KeyConditionExpression: 'tenantId = :tenantId AND #key = :key',
        ExpressionAttributeNames: {
          '#key': 'key',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':key': key,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    // GSI returns partial, fetch full item
    const item = result.Items[0] as { tenantId: string; id: string };
    return this.getById(item.tenantId, item.id);
  }

  async getByKeys(tenantId: string, keys: string[]): Promise<Role[]> {
    if (keys.length === 0) {
      return [];
    }

    // Get roles by keys using queries
    const roles: Role[] = [];
    for (const key of keys) {
      const role = await this.getByKey(tenantId, key);
      if (role) {
        roles.push(role);
      }
    }

    return roles;
  }

  async update(tenantId: string, id: string, data: UpdateRoleDTO, updatedBy: string): Promise<Role> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('ROLE_NOT_FOUND', 'Role not found', 404);
    }

    if (existing.isSystem) {
      throw new AppError('SYSTEM_ROLE', 'Cannot modify system role', 403);
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

    return result.Attributes as Role;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('ROLE_NOT_FOUND', 'Role not found', 404);
    }

    if (existing.isSystem) {
      throw new AppError('SYSTEM_ROLE', 'Cannot delete system role', 403);
    }

    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Role>> {
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

    const items = (result.Items as Role[]) || [];
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

  async listWithFilters(tenantId: string, params: ListRolesParams): Promise<PaginatedResult<Role>> {
    const limit = params.limit || 20;
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = { ':tenantId': tenantId };
    const expressionAttributeNames: Record<string, string> = {};

    if (params.riskLevel) {
      filterExpressions.push('riskLevel = :riskLevel');
      expressionAttributeValues[':riskLevel'] = params.riskLevel;
    }

    if (params.isSystem !== undefined) {
      filterExpressions.push('isSystem = :isSystem');
      expressionAttributeValues[':isSystem'] = params.isSystem;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as Role[]) || [];
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
}
