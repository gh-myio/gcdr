import { GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  IntegrationPackage,
  PackageSubscription,
  PackageStatus,
  PackageVersion,
} from '../domain/entities/IntegrationPackage';
import { CreatePackageDTO, UpdatePackageDTO, SearchPackagesDTO } from '../dto/request/IntegrationDTO';
import { PaginatedResult } from '../shared/types';
import { IIntegrationPackageRepository, ISubscriptionRepository } from './interfaces/IIntegrationRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class IntegrationPackageRepository implements IIntegrationPackageRepository {
  private tableName = TableNames.INTEGRATIONS;

  async create(
    tenantId: string,
    data: CreatePackageDTO,
    publisherId: string,
    publisherName: string
  ): Promise<IntegrationPackage> {
    const id = generateId();
    const timestamp = now();

    const pkg: IntegrationPackage = {
      id,
      tenantId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      longDescription: data.longDescription,
      category: data.category,
      tags: data.tags,
      iconUrl: data.iconUrl,
      documentationUrl: data.documentationUrl,
      type: data.type,
      status: 'DRAFT',
      currentVersion: '0.0.0',
      versions: [],
      publisherId,
      publisherName,
      verified: false,
      scopes: data.scopes,
      capabilities: data.capabilities,
      endpoints: data.endpoints,
      events: data.events,
      auth: data.auth,
      rateLimits: data.rateLimits,
      pricing: data.pricing,
      subscriberCount: 0,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: publisherId,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: pkg,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return pkg;
  }

  async getById(tenantId: string, id: string): Promise<IntegrationPackage | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as IntegrationPackage) || null;
  }

  async getBySlug(tenantId: string, slug: string): Promise<IntegrationPackage | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-slug',
        KeyConditionExpression: 'tenantId = :tenantId AND slug = :slug',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':slug': slug,
        },
        Limit: 1,
      })
    );

    return result.Items && result.Items.length > 0 ? (result.Items[0] as IntegrationPackage) : null;
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdatePackageDTO,
    updatedBy: string
  ): Promise<IntegrationPackage> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PACKAGE_NOT_FOUND', 'Integration package not found', 404);
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

    return result.Attributes as IntegrationPackage;
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

  async search(tenantId: string, params: SearchPackagesDTO): Promise<PaginatedResult<IntegrationPackage>> {
    const limit = params.limit || 20;

    // Build filter expression
    const filterExpressions: string[] = ['#status = :status'];
    const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
    const expressionAttributeValues: Record<string, unknown> = { ':status': params.status || 'PUBLISHED' };

    if (params.category) {
      filterExpressions.push('category = :category');
      expressionAttributeValues[':category'] = params.category;
    }

    if (params.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params.pricing) {
      filterExpressions.push('pricing.model = :pricing');
      expressionAttributeValues[':pricing'] = params.pricing;
    }

    if (params.verified !== undefined) {
      filterExpressions.push('verified = :verified');
      expressionAttributeValues[':verified'] = params.verified;
    }

    if (params.query) {
      filterExpressions.push('(contains(#name, :query) OR contains(description, :query))');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':query'] = params.query;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: filterExpressions.join(' AND '),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ...expressionAttributeValues,
        },
        Limit: limit + 1,
        ExclusiveStartKey: params.cursor
          ? JSON.parse(Buffer.from(params.cursor, 'base64').toString())
          : undefined,
      })
    );

    const items = (result.Items as IntegrationPackage[]) || [];
    const hasMore = items.length > limit;
    const returnItems = hasMore ? items.slice(0, limit) : items;

    // Sort if specified
    if (params.sortBy) {
      returnItems.sort((a, b) => {
        const aVal = a[params.sortBy as keyof IntegrationPackage];
        const bVal = b[params.sortBy as keyof IntegrationPackage];
        const order = params.sortOrder === 'desc' ? -1 : 1;
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return aVal.localeCompare(bVal) * order;
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * order;
        }
        return 0;
      });
    }

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

  async listByPublisher(tenantId: string, publisherId: string): Promise<IntegrationPackage[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-publisher',
        KeyConditionExpression: 'tenantId = :tenantId AND publisherId = :publisherId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':publisherId': publisherId,
        },
      })
    );

    return (result.Items as IntegrationPackage[]) || [];
  }

  async listByStatus(tenantId: string, status: PackageStatus): Promise<IntegrationPackage[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-status',
        KeyConditionExpression: 'tenantId = :tenantId AND #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':status': status,
        },
      })
    );

    return (result.Items as IntegrationPackage[]) || [];
  }

  async listByCategory(tenantId: string, category: string): Promise<IntegrationPackage[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-category',
        KeyConditionExpression: 'tenantId = :tenantId AND category = :category',
        FilterExpression: '#status = :published',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':category': category,
          ':published': 'PUBLISHED',
        },
      })
    );

    return (result.Items as IntegrationPackage[]) || [];
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: PackageStatus,
    updatedBy: string
  ): Promise<IntegrationPackage> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PACKAGE_NOT_FOUND', 'Integration package not found', 404);
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

    return result.Attributes as IntegrationPackage;
  }

  async publish(
    tenantId: string,
    id: string,
    version: string,
    releaseNotes: string,
    breaking: boolean
  ): Promise<IntegrationPackage> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PACKAGE_NOT_FOUND', 'Integration package not found', 404);
    }

    const timestamp = now();

    const newVersion: PackageVersion = {
      version,
      releaseNotes,
      publishedAt: timestamp,
      breaking,
    };

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET currentVersion = :currentVersion, versions = list_append(versions, :newVersion),
          #status = :status, publishedAt = :publishedAt, updatedAt = :updatedAt,
          #version = #version + :inc`,
        ConditionExpression: '#version = :existingVersion',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':currentVersion': version,
          ':newVersion': [newVersion],
          ':status': 'PUBLISHED',
          ':publishedAt': timestamp,
          ':updatedAt': timestamp,
          ':existingVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as IntegrationPackage;
  }

  async deprecate(tenantId: string, id: string, reason: string): Promise<IntegrationPackage> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PACKAGE_NOT_FOUND', 'Integration package not found', 404);
    }

    const timestamp = now();

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET #status = :status, deprecatedAt = :deprecatedAt, updatedAt = :updatedAt,
          #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':status': 'DEPRECATED',
          ':deprecatedAt': timestamp,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as IntegrationPackage;
  }

  async incrementSubscriberCount(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: 'SET subscriberCount = subscriberCount + :inc',
        ExpressionAttributeValues: {
          ':inc': 1,
        },
      })
    );
  }

  async decrementSubscriberCount(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: 'SET subscriberCount = subscriberCount - :dec',
        ConditionExpression: 'subscriberCount > :zero',
        ExpressionAttributeValues: {
          ':dec': 1,
          ':zero': 0,
        },
      })
    );
  }
}

export class SubscriptionRepository implements ISubscriptionRepository {
  private tableName = TableNames.SUBSCRIPTIONS;

  async create(
    tenantId: string,
    packageId: string,
    packageVersion: string,
    subscriberId: string,
    subscriberType: 'partner' | 'customer',
    config?: Record<string, unknown>
  ): Promise<PackageSubscription> {
    const id = generateId();
    const timestamp = now();

    const subscription: PackageSubscription = {
      id,
      packageId,
      packageVersion,
      subscriberId,
      subscriberType,
      status: 'ACTIVE',
      subscribedAt: timestamp,
      config,
      usageStats: {
        requestCount: 0,
        monthlyUsage: 0,
      },
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          tenantId,
          ...subscription,
        },
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return subscription;
  }

  async getById(tenantId: string, id: string): Promise<PackageSubscription | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as PackageSubscription) || null;
  }

  async getByPackageAndSubscriber(
    tenantId: string,
    packageId: string,
    subscriberId: string
  ): Promise<PackageSubscription | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-subscriber',
        KeyConditionExpression: 'tenantId = :tenantId AND subscriberId = :subscriberId',
        FilterExpression: 'packageId = :packageId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':subscriberId': subscriberId,
          ':packageId': packageId,
        },
        Limit: 1,
      })
    );

    return result.Items && result.Items.length > 0 ? (result.Items[0] as PackageSubscription) : null;
  }

  async update(
    tenantId: string,
    id: string,
    data: { version?: string; config?: Record<string, unknown>; status?: string }
  ): Promise<PackageSubscription> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    if (data.version) {
      updateExpressions.push('packageVersion = :version');
      expressionAttributeValues[':version'] = data.version;
    }

    if (data.config) {
      updateExpressions.push('config = :config');
      expressionAttributeValues[':config'] = data.config;
    }

    if (data.status) {
      updateExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = data.status;
    }

    if (updateExpressions.length === 0) {
      const existing = await this.getById(tenantId, id);
      if (!existing) {
        throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
      }
      return existing;
    }

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as PackageSubscription;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );
  }

  async listBySubscriber(tenantId: string, subscriberId: string): Promise<PackageSubscription[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-subscriber',
        KeyConditionExpression: 'tenantId = :tenantId AND subscriberId = :subscriberId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':subscriberId': subscriberId,
        },
      })
    );

    return (result.Items as PackageSubscription[]) || [];
  }

  async listByPackage(tenantId: string, packageId: string): Promise<PackageSubscription[]> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-package',
        KeyConditionExpression: 'tenantId = :tenantId AND packageId = :packageId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':packageId': packageId,
        },
      })
    );

    return (result.Items as PackageSubscription[]) || [];
  }

  async updateUsageStats(tenantId: string, id: string, requestCount: number): Promise<void> {
    const timestamp = now();

    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET usageStats.requestCount = usageStats.requestCount + :count,
          usageStats.monthlyUsage = usageStats.monthlyUsage + :count,
          usageStats.lastRequestAt = :timestamp`,
        ExpressionAttributeValues: {
          ':count': requestCount,
          ':timestamp': timestamp,
        },
      })
    );
  }
}
