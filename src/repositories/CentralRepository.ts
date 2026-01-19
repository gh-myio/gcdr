import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Central, ConnectionStatus, createDefaultCentralConfig, createDefaultCentralStats } from '../domain/entities/Central';
import { CreateCentralDTO, UpdateCentralDTO, ListCentralsDTO } from '../dto/request/CentralDTO';
import { PaginatedResult, EntityStatus } from '../shared/types';
import { ICentralRepository } from './interfaces/ICentralRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class CentralRepository implements ICentralRepository {
  private tableName = TableNames.CENTRALS;

  async create(tenantId: string, data: CreateCentralDTO, createdBy: string): Promise<Central> {
    const id = generateId();
    const timestamp = now();

    const central: Central = {
      id,
      tenantId,
      customerId: data.customerId,
      assetId: data.assetId,
      name: data.name,
      displayName: data.displayName,
      serialNumber: data.serialNumber,
      type: data.type,
      status: 'ACTIVE',
      connectionStatus: 'OFFLINE',
      firmwareVersion: data.firmwareVersion || '0.0.0',
      softwareVersion: data.softwareVersion || '0.0.0',
      config: data.config ? { ...createDefaultCentralConfig(), ...data.config } : createDefaultCentralConfig(),
      stats: createDefaultCentralStats(),
      location: data.location,
      tags: data.tags || [],
      metadata: data.metadata || {},
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: central,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return central;
  }

  async getById(tenantId: string, id: string): Promise<Central | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Central) || null;
  }

  async getBySerialNumber(tenantId: string, serialNumber: string): Promise<Central | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-serial',
        KeyConditionExpression: 'tenantId = :tenantId AND serialNumber = :serialNumber',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':serialNumber': serialNumber,
        },
        Limit: 1,
      })
    );

    return result.Items && result.Items.length > 0 ? (result.Items[0] as Central) : null;
  }

  async update(tenantId: string, id: string, data: UpdateCentralDTO, updatedBy: string): Promise<Central> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('CENTRAL_NOT_FOUND', 'Central not found', 404);
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

    // Merge config if provided
    if (data.config) {
      fieldsToUpdate.config = { ...existing.config, ...data.config };
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

    return result.Attributes as Central;
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

  async list(tenantId: string, params: ListCentralsDTO): Promise<PaginatedResult<Central>> {
    const limit = params.limit || 20;

    const filterExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = { ':tenantId': tenantId };

    if (params.customerId) {
      filterExpressions.push('customerId = :customerId');
      expressionAttributeValues[':customerId'] = params.customerId;
    }

    if (params.assetId) {
      filterExpressions.push('assetId = :assetId');
      expressionAttributeValues[':assetId'] = params.assetId;
    }

    if (params.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = params.status;
    }

    if (params.connectionStatus) {
      filterExpressions.push('connectionStatus = :connectionStatus');
      expressionAttributeValues[':connectionStatus'] = params.connectionStatus;
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

    const items = (result.Items as Central[]) || [];
    const hasMore = items.length > limit;
    const returnItems = hasMore ? items.slice(0, limit) : items;

    return {
      items: returnItems,
      pagination: {
        hasMore,
        nextCursor:
          hasMore && result.LastEvaluatedKey
            ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
            : undefined,
      },
    };
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<Central[]> {
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

    return (result.Items as Central[]) || [];
  }

  async listByAsset(tenantId: string, assetId: string): Promise<Central[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-asset',
        KeyConditionExpression: 'tenantId = :tenantId AND assetId = :assetId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':assetId': assetId,
        },
      })
    );

    return (result.Items as Central[]) || [];
  }

  async updateStatus(tenantId: string, id: string, status: EntityStatus, updatedBy: string): Promise<Central> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('CENTRAL_NOT_FOUND', 'Central not found', 404);
    }

    const timestamp = now();

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET #status = :status, updatedAt = :updatedAt, updatedBy = :updatedBy,
          #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': timestamp,
          ':updatedBy': updatedBy,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Central;
  }

  async updateConnectionStatus(
    tenantId: string,
    id: string,
    connectionStatus: ConnectionStatus,
    stats?: Partial<Central['stats']>
  ): Promise<Central> {
    const timestamp = now();

    const updateExpression = stats
      ? `SET connectionStatus = :connectionStatus, stats = :stats, updatedAt = :updatedAt`
      : `SET connectionStatus = :connectionStatus, updatedAt = :updatedAt`;

    const expressionAttributeValues: Record<string, unknown> = {
      ':connectionStatus': connectionStatus,
      ':updatedAt': timestamp,
    };

    if (stats) {
      const existing = await this.getById(tenantId, id);
      if (existing) {
        expressionAttributeValues[':stats'] = {
          ...existing.stats,
          ...stats,
          lastHeartbeatAt: timestamp,
        };
      }
    }

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Central;
  }

  async recordHeartbeat(tenantId: string, id: string, stats: Partial<Central['stats']>): Promise<void> {
    const timestamp = now();
    const existing = await this.getById(tenantId, id);

    if (!existing) {
      throw new AppError('CENTRAL_NOT_FOUND', 'Central not found', 404);
    }

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET connectionStatus = :online, stats = :stats, updatedAt = :updatedAt`,
        ExpressionAttributeValues: {
          ':online': 'ONLINE',
          ':stats': {
            ...existing.stats,
            ...stats,
            lastHeartbeatAt: timestamp,
          },
          ':updatedAt': timestamp,
        },
      })
    );
  }
}
