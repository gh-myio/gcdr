import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Rule, RuleType } from '../domain/entities/Rule';
import { CreateRuleDTO, UpdateRuleDTO } from '../dto/request/RuleDTO';
import { PaginatedResult } from '../shared/types';
import { IRuleRepository, ListRulesParams } from './interfaces/IRuleRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class RuleRepository implements IRuleRepository {
  private tableName = TableNames.RULES;

  async create(tenantId: string, data: CreateRuleDTO, createdBy: string): Promise<Rule> {
    const id = generateId();
    const timestamp = now();

    const rule: Rule = {
      id,
      tenantId,
      customerId: data.customerId,
      name: data.name,
      description: data.description,
      type: data.type,
      priority: data.priority || 'MEDIUM',
      scope: data.scope,
      alarmConfig: data.alarmConfig,
      slaConfig: data.slaConfig,
      escalationConfig: data.escalationConfig,
      maintenanceConfig: data.maintenanceConfig,
      notificationChannels: data.notificationChannels,
      tags: data.tags || [],
      status: 'ACTIVE',
      enabled: data.enabled ?? true,
      triggerCount: 0,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: rule,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return rule;
  }

  async getById(tenantId: string, id: string): Promise<Rule | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Rule) || null;
  }

  async update(tenantId: string, id: string, data: UpdateRuleDTO, updatedBy: string): Promise<Rule> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('RULE_NOT_FOUND', 'Rule not found', 404);
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

    return result.Attributes as Rule;
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

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Rule>> {
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

    const items = (result.Items as Rule[]) || [];
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

  async listWithFilters(tenantId: string, params: ListRulesParams): Promise<PaginatedResult<Rule>> {
    const limit = params.limit || 20;
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = { ':tenantId': tenantId };
    const expressionAttributeNames: Record<string, string> = {};

    if (params.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params.priority) {
      filterExpressions.push('priority = :priority');
      expressionAttributeValues[':priority'] = params.priority;
    }

    if (params.customerId) {
      filterExpressions.push('customerId = :customerId');
      expressionAttributeValues[':customerId'] = params.customerId;
    }

    if (params.enabled !== undefined) {
      filterExpressions.push('enabled = :enabled');
      expressionAttributeValues[':enabled'] = params.enabled;
    }

    if (params.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = params.status;
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

    const items = (result.Items as Rule[]) || [];
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

  async getByCustomerId(tenantId: string, customerId: string): Promise<Rule[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-customer',
        KeyConditionExpression: 'tenantId = :tenantId AND customerId = :customerId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':customerId': customerId,
        },
      })
    );

    return (result.Items as Rule[]) || [];
  }

  async getByType(tenantId: string, type: RuleType): Promise<Rule[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-type',
        KeyConditionExpression: 'tenantId = :tenantId AND #type = :type',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':type': type,
        },
      })
    );

    return (result.Items as Rule[]) || [];
  }

  async getActiveMaintenanceWindows(tenantId: string): Promise<Rule[]> {
    const currentTime = now();
    const rules = await this.getByType(tenantId, 'MAINTENANCE_WINDOW');

    return rules.filter((rule) => {
      if (!rule.enabled || !rule.maintenanceConfig) return false;

      const config = rule.maintenanceConfig;

      // For one-time windows
      if (config.recurrence === 'ONCE' && config.endTime) {
        return config.startTime <= currentTime && currentTime <= config.endTime;
      }

      // For recurring windows, this is a simplified check
      // Full implementation would handle timezone and recurrence patterns
      return rule.enabled && rule.status === 'ACTIVE';
    });
  }

  async getEnabledRules(tenantId: string): Promise<Rule[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: 'enabled = :enabled AND #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':enabled': true,
          ':status': 'ACTIVE',
        },
      })
    );

    return (result.Items as Rule[]) || [];
  }

  async getByScope(tenantId: string, scopeType: string, entityId: string): Promise<Rule[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: 'scope.#type = :scopeType AND scope.entityId = :entityId',
        ExpressionAttributeNames: {
          '#type': 'type',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':scopeType': scopeType,
          ':entityId': entityId,
        },
      })
    );

    return (result.Items as Rule[]) || [];
  }

  async incrementTriggerCount(tenantId: string, ruleId: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: ruleId },
        UpdateExpression: 'SET triggerCount = if_not_exists(triggerCount, :zero) + :inc, lastTriggeredAt = :now',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':inc': 1,
          ':now': now(),
        },
      })
    );
  }

  async updateLastTriggered(tenantId: string, ruleId: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: ruleId },
        UpdateExpression: 'SET lastTriggeredAt = :now',
        ExpressionAttributeValues: {
          ':now': now(),
        },
      })
    );
  }
}
