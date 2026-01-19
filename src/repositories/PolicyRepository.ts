import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Policy } from '../domain/entities/Policy';
import { CreatePolicyDTO } from '../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../shared/types';
import { IPolicyRepository, UpdatePolicyDTO, ListPoliciesParams } from './interfaces/IPolicyRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class PolicyRepository implements IPolicyRepository {
  private tableName = TableNames.POLICIES;

  async create(tenantId: string, data: CreatePolicyDTO, createdBy: string): Promise<Policy> {
    // Check if key already exists
    const existing = await this.getByKey(tenantId, data.key);
    if (existing) {
      throw new AppError('POLICY_KEY_EXISTS', `Policy with key '${data.key}' already exists`, 409);
    }

    const id = generateId();
    const timestamp = now();

    const policy: Policy = {
      id,
      tenantId,
      key: data.key,
      displayName: data.displayName,
      description: data.description || '',
      allow: data.allow || [],
      deny: data.deny || [],
      conditions: data.conditions,
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
        Item: policy,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return policy;
  }

  async getById(tenantId: string, id: string): Promise<Policy | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Policy) || null;
  }

  async getByKey(tenantId: string, key: string): Promise<Policy | null> {
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

    const item = result.Items[0] as { tenantId: string; id: string };
    return this.getById(item.tenantId, item.id);
  }

  async getByKeys(tenantId: string, keys: string[]): Promise<Policy[]> {
    if (keys.length === 0) {
      return [];
    }

    const policies: Policy[] = [];
    for (const key of keys) {
      const policy = await this.getByKey(tenantId, key);
      if (policy) {
        policies.push(policy);
      }
    }

    return policies;
  }

  async update(tenantId: string, id: string, data: UpdatePolicyDTO, updatedBy: string): Promise<Policy> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('POLICY_NOT_FOUND', 'Policy not found', 404);
    }

    if (existing.isSystem) {
      throw new AppError('SYSTEM_POLICY', 'Cannot modify system policy', 403);
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

    return result.Attributes as Policy;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('POLICY_NOT_FOUND', 'Policy not found', 404);
    }

    if (existing.isSystem) {
      throw new AppError('SYSTEM_POLICY', 'Cannot delete system policy', 403);
    }

    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Policy>> {
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

    const items = (result.Items as Policy[]) || [];
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

  async listWithFilters(tenantId: string, params: ListPoliciesParams): Promise<PaginatedResult<Policy>> {
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

    const items = (result.Items as Policy[]) || [];
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
