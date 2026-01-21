import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { CustomerApiKey } from '../domain/entities/CustomerApiKey';
import { ICustomerApiKeyRepository } from './interfaces/ICustomerApiKeyRepository';
import { PaginatedResult, PaginationParams } from '../shared/types';

export class CustomerApiKeyRepository implements ICustomerApiKeyRepository {
  private tableName = TableNames.CUSTOMER_API_KEYS;

  async create(apiKey: CustomerApiKey): Promise<CustomerApiKey> {
    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: apiKey,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
    return apiKey;
  }

  async getById(tenantId: string, id: string): Promise<CustomerApiKey | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );
    return (result.Item as CustomerApiKey) || null;
  }

  async getByKeyHash(tenantId: string, keyHash: string): Promise<CustomerApiKey | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-key-hash',
        KeyConditionExpression: 'tenantId = :tenantId AND keyHash = :keyHash',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':keyHash': keyHash,
        },
        Limit: 1,
      })
    );
    return (result.Items?.[0] as CustomerApiKey) || null;
  }

  async listByCustomer(
    tenantId: string,
    customerId: string,
    options?: PaginationParams & { isActive?: boolean }
  ): Promise<PaginatedResult<CustomerApiKey>> {
    const limit = options?.limit || 20;

    let filterExpression: string | undefined;
    const expressionAttributeValues: Record<string, unknown> = {
      ':tenantId': tenantId,
      ':customerId': customerId,
    };

    if (options?.isActive !== undefined) {
      filterExpression = 'isActive = :isActive';
      expressionAttributeValues[':isActive'] = options.isActive;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-customer',
        KeyConditionExpression: 'tenantId = :tenantId AND customerId = :customerId',
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit,
        ExclusiveStartKey: options?.cursor
          ? JSON.parse(Buffer.from(options.cursor, 'base64').toString())
          : undefined,
      })
    );

    const items = (result.Items || []) as CustomerApiKey[];
    let nextCursor: string | undefined;

    if (result.LastEvaluatedKey) {
      nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    return {
      items,
      pagination: {
        hasMore: !!result.LastEvaluatedKey,
        nextCursor,
      },
    };
  }

  async update(apiKey: CustomerApiKey): Promise<CustomerApiKey> {
    const now = new Date().toISOString();

    const updated = {
      ...apiKey,
      updatedAt: now,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: updated,
      })
    );

    return updated;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );
  }

  async updateLastUsed(tenantId: string, id: string, ip: string): Promise<void> {
    const now = new Date().toISOString();

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: 'SET lastUsedAt = :lastUsedAt, lastUsedIp = :lastUsedIp',
        ExpressionAttributeValues: {
          ':lastUsedAt': now,
          ':lastUsedIp': ip,
        },
      })
    );
  }

  async incrementUsageCount(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: 'SET usageCount = if_not_exists(usageCount, :zero) + :inc',
        ExpressionAttributeValues: {
          ':zero': 0,
          ':inc': 1,
        },
      })
    );
  }
}

export const customerApiKeyRepository = new CustomerApiKeyRepository();
