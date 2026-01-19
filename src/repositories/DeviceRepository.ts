import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Device, ConnectivityStatus, createDefaultDeviceSpecs, createDefaultTelemetryConfig } from '../domain/entities/Device';
import { CreateDeviceDTO, UpdateDeviceDTO, ListDevicesParams } from '../dto/request/DeviceDTO';
import { PaginatedResult } from '../shared/types';
import { IDeviceRepository } from './interfaces/IDeviceRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class DeviceRepository implements IDeviceRepository {
  private tableName = TableNames.DEVICES;

  async create(tenantId: string, data: CreateDeviceDTO, customerId: string, createdBy: string): Promise<Device> {
    const id = generateId();
    const timestamp = now();

    const device: Device = {
      id,
      tenantId,
      assetId: data.assetId,
      customerId,
      name: data.name,
      displayName: data.displayName || data.name,
      label: data.label,
      type: data.type,
      description: data.description,
      serialNumber: data.serialNumber,
      externalId: data.externalId,
      specs: data.specs || createDefaultDeviceSpecs(data.serialNumber),
      connectivityStatus: 'UNKNOWN',
      credentials: data.credentials,
      telemetryConfig: data.telemetryConfig || createDefaultTelemetryConfig(),
      tags: data.tags || [],
      metadata: data.metadata || {},
      attributes: data.attributes || {},
      status: 'ACTIVE',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: device,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return device;
  }

  async getById(tenantId: string, id: string): Promise<Device | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Device) || null;
  }

  async getBySerialNumber(tenantId: string, serialNumber: string): Promise<Device | null> {
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

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    // GSI only has keys, need to fetch full item
    const item = result.Items[0] as { tenantId: string; id: string };
    return this.getById(item.tenantId, item.id);
  }

  async getByExternalId(tenantId: string, externalId: string): Promise<Device | null> {
    // Note: This requires a scan or a new GSI for externalId
    // For now, we'll use a query with filter
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: 'externalId = :externalId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':externalId': externalId,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return result.Items[0] as Device;
  }

  async update(tenantId: string, id: string, data: UpdateDeviceDTO, updatedBy: string): Promise<Device> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('DEVICE_NOT_FOUND', 'Device not found', 404);
    }

    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    // Build dynamic update expression
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

    return result.Attributes as Device;
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

  async list(tenantId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = { ':tenantId': tenantId };
    const expressionAttributeNames: Record<string, string> = {};

    // Add filters
    if (params?.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params?.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = params.status;
    }

    if (params?.connectivityStatus) {
      filterExpressions.push('connectivityStatus = :connectivity');
      expressionAttributeValues[':connectivity'] = params.connectivityStatus;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params?.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as Device[]) || [];
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

  async listByAsset(tenantId: string, assetId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {
      ':tenantId': tenantId,
      ':assetId': assetId,
    };
    const expressionAttributeNames: Record<string, string> = {};

    // Add filters
    if (params?.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params?.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = params.status;
    }

    if (params?.connectivityStatus) {
      filterExpressions.push('connectivityStatus = :connectivity');
      expressionAttributeValues[':connectivity'] = params.connectivityStatus;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-asset',
        KeyConditionExpression: 'tenantId = :tenantId AND assetId = :assetId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params?.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as Device[]) || [];
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

  async listByCustomer(tenantId: string, customerId: string, params?: ListDevicesParams): Promise<PaginatedResult<Device>> {
    const limit = params?.limit || 20;
    const filterExpressions: string[] = ['customerId = :customerId'];
    const expressionAttributeValues: Record<string, unknown> = {
      ':tenantId': tenantId,
      ':customerId': customerId,
    };
    const expressionAttributeNames: Record<string, string> = {};

    // Add filters
    if (params?.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params?.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = params.status;
    }

    if (params?.connectivityStatus) {
      filterExpressions.push('connectivityStatus = :connectivity');
      expressionAttributeValues[':connectivity'] = params.connectivityStatus;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: filterExpressions.join(' AND '),
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params?.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as Device[]) || [];
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

  async updateConnectivityStatus(tenantId: string, id: string, status: ConnectivityStatus): Promise<Device> {
    const timestamp = now();
    const updateExpression = status === 'ONLINE'
      ? 'SET connectivityStatus = :status, lastConnectedAt = :timestamp, updatedAt = :timestamp'
      : status === 'OFFLINE'
        ? 'SET connectivityStatus = :status, lastDisconnectedAt = :timestamp, updatedAt = :timestamp'
        : 'SET connectivityStatus = :status, updatedAt = :timestamp';

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: {
          ':status': status,
          ':timestamp': timestamp,
        },
        ConditionExpression: 'attribute_exists(id)',
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Device;
  }

  async move(tenantId: string, deviceId: string, newAssetId: string, newCustomerId: string, updatedBy: string): Promise<Device> {
    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: deviceId },
        UpdateExpression: 'SET assetId = :assetId, customerId = :customerId, updatedAt = :updatedAt, updatedBy = :updatedBy',
        ExpressionAttributeValues: {
          ':assetId': newAssetId,
          ':customerId': newCustomerId,
          ':updatedAt': now(),
          ':updatedBy': updatedBy,
        },
        ConditionExpression: 'attribute_exists(id)',
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Device;
  }

  async countByAsset(tenantId: string, assetId: string): Promise<number> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-asset',
        KeyConditionExpression: 'tenantId = :tenantId AND assetId = :assetId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':assetId': assetId,
        },
        Select: 'COUNT',
      })
    );

    return result.Count || 0;
  }

  async countByCustomer(tenantId: string, customerId: string): Promise<number> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: 'customerId = :customerId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':customerId': customerId,
        },
        Select: 'COUNT',
      })
    );

    return result.Count || 0;
  }
}
