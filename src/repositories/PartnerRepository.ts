import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Partner, ApiKey, OAuthClient, WebhookSubscription } from '../domain/entities/Partner';
import { RegisterPartnerDTO, UpdatePartnerDTO, ApprovePartnerDTO, UpdateWebhookDTO } from '../dto/request/PartnerDTO';
import { PaginatedResult, PartnerStatus } from '../shared/types';
import { IPartnerRepository, ListPartnersParams } from './interfaces/IPartnerRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class PartnerRepository implements IPartnerRepository {
  private tableName = TableNames.PARTNERS;

  async create(tenantId: string, data: RegisterPartnerDTO, createdBy: string): Promise<Partner> {
    const id = generateId();
    const timestamp = now();

    const partner: Partner = {
      id,
      tenantId,
      status: 'PENDING',
      companyName: data.companyName,
      companyWebsite: data.companyWebsite,
      companyDescription: data.companyDescription,
      industry: data.industry,
      country: data.country,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      technicalContactEmail: data.technicalContactEmail,
      apiKeys: [],
      oauthClients: [],
      webhooks: [],
      scopes: [],
      rateLimitPerMinute: 0,
      rateLimitPerDay: 0,
      monthlyQuota: 0,
      subscribedPackages: [],
      publishedPackages: [],
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: partner,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return partner;
  }

  async getById(tenantId: string, id: string): Promise<Partner | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Partner) || null;
  }

  async getByEmail(tenantId: string, email: string): Promise<Partner | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: 'contactEmail = :email',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':email': email,
        },
        Limit: 1,
      })
    );

    return result.Items && result.Items.length > 0 ? (result.Items[0] as Partner) : null;
  }

  async update(tenantId: string, id: string, data: UpdatePartnerDTO, updatedBy: string): Promise<Partner> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
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

    return result.Attributes as Partner;
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

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Partner>> {
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

    const items = (result.Items as Partner[]) || [];
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

  async listWithFilters(tenantId: string, params: ListPartnersParams): Promise<PaginatedResult<Partner>> {
    const limit = params.limit || 20;

    let queryCommand: QueryCommand;

    if (params.status) {
      queryCommand = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-status',
        KeyConditionExpression: 'tenantId = :tenantId AND #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':status': params.status,
        },
        Limit: limit + 1,
        ExclusiveStartKey: params.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      });
    } else {
      queryCommand = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
        Limit: limit + 1,
        ExclusiveStartKey: params.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      });
    }

    const result = await dynamoDb.send(queryCommand);
    const items = (result.Items as Partner[]) || [];
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

  async getByStatus(tenantId: string, status: PartnerStatus): Promise<Partner[]> {
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

    return (result.Items as Partner[]) || [];
  }

  async approve(tenantId: string, id: string, data: ApprovePartnerDTO, approvedBy: string): Promise<Partner> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    if (existing.status !== 'PENDING') {
      throw new AppError('INVALID_STATUS', `Cannot approve partner with status ${existing.status}`, 400);
    }

    const timestamp = now();

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET #status = :status, scopes = :scopes, rateLimitPerMinute = :rateLimitPerMinute,
          rateLimitPerDay = :rateLimitPerDay, monthlyQuota = :monthlyQuota,
          approvedAt = :approvedAt, approvedBy = :approvedBy, updatedAt = :updatedAt,
          #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':status': 'APPROVED',
          ':scopes': data.scopes,
          ':rateLimitPerMinute': data.rateLimitPerMinute,
          ':rateLimitPerDay': data.rateLimitPerDay,
          ':monthlyQuota': data.monthlyQuota,
          ':approvedAt': timestamp,
          ':approvedBy': approvedBy,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async reject(tenantId: string, id: string, reason: string, rejectedBy: string): Promise<Partner> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    if (existing.status !== 'PENDING') {
      throw new AppError('INVALID_STATUS', `Cannot reject partner with status ${existing.status}`, 400);
    }

    const timestamp = now();

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET #status = :status, rejectedAt = :rejectedAt, rejectedBy = :rejectedBy,
          rejectionReason = :reason, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':status': 'REJECTED',
          ':rejectedAt': timestamp,
          ':rejectedBy': rejectedBy,
          ':reason': reason,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async suspend(tenantId: string, id: string, reason: string, suspendedBy: string): Promise<Partner> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    if (existing.status !== 'ACTIVE' && existing.status !== 'APPROVED') {
      throw new AppError('INVALID_STATUS', `Cannot suspend partner with status ${existing.status}`, 400);
    }

    const timestamp = now();

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET #status = :status, suspendedAt = :suspendedAt, suspendedBy = :suspendedBy,
          suspensionReason = :reason, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':status': 'SUSPENDED',
          ':suspendedAt': timestamp,
          ':suspendedBy': suspendedBy,
          ':reason': reason,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async activate(tenantId: string, id: string, activatedBy: string): Promise<Partner> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    if (existing.status !== 'APPROVED' && existing.status !== 'SUSPENDED') {
      throw new AppError('INVALID_STATUS', `Cannot activate partner with status ${existing.status}`, 400);
    }

    const timestamp = now();

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        UpdateExpression: `SET #status = :status, activatedAt = :activatedAt, activatedBy = :activatedBy,
          updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':status': 'ACTIVE',
          ':activatedAt': timestamp,
          ':activatedBy': activatedBy,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async addApiKey(tenantId: string, partnerId: string, apiKey: ApiKey): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const timestamp = now();
    const updatedApiKeys = [...existing.apiKeys, apiKey];

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: partnerId },
        UpdateExpression: `SET apiKeys = :apiKeys, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':apiKeys': updatedApiKeys,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async revokeApiKey(tenantId: string, partnerId: string, apiKeyId: string): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const keyIndex = existing.apiKeys.findIndex((k) => k.id === apiKeyId);
    if (keyIndex === -1) {
      throw new AppError('API_KEY_NOT_FOUND', 'API key not found', 404);
    }

    const timestamp = now();
    const updatedApiKeys = existing.apiKeys.map((k) =>
      k.id === apiKeyId ? { ...k, status: 'REVOKED' as const, revokedAt: timestamp } : k
    );

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: partnerId },
        UpdateExpression: `SET apiKeys = :apiKeys, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':apiKeys': updatedApiKeys,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async addOAuthClient(tenantId: string, partnerId: string, client: OAuthClient): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const timestamp = now();
    const updatedClients = [...existing.oauthClients, client];

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: partnerId },
        UpdateExpression: `SET oauthClients = :clients, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':clients': updatedClients,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async revokeOAuthClient(tenantId: string, partnerId: string, clientId: string): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const clientIndex = existing.oauthClients.findIndex((c) => c.clientId === clientId);
    if (clientIndex === -1) {
      throw new AppError('OAUTH_CLIENT_NOT_FOUND', 'OAuth client not found', 404);
    }

    const timestamp = now();
    const updatedClients = existing.oauthClients.map((c) =>
      c.clientId === clientId ? { ...c, status: 'REVOKED' as const, revokedAt: timestamp } : c
    );

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: partnerId },
        UpdateExpression: `SET oauthClients = :clients, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':clients': updatedClients,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async addWebhook(tenantId: string, partnerId: string, webhook: WebhookSubscription): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const timestamp = now();
    const updatedWebhooks = [...existing.webhooks, webhook];

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: partnerId },
        UpdateExpression: `SET webhooks = :webhooks, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':webhooks': updatedWebhooks,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async updateWebhook(
    tenantId: string,
    partnerId: string,
    webhookId: string,
    data: UpdateWebhookDTO
  ): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const webhookIndex = existing.webhooks.findIndex((w) => w.id === webhookId);
    if (webhookIndex === -1) {
      throw new AppError('WEBHOOK_NOT_FOUND', 'Webhook not found', 404);
    }

    const timestamp = now();
    const updatedWebhooks = existing.webhooks.map((w) =>
      w.id === webhookId
        ? {
            ...w,
            ...(data.url && { url: data.url }),
            ...(data.events && { events: data.events }),
            ...(data.enabled !== undefined && { enabled: data.enabled }),
            updatedAt: timestamp,
          }
        : w
    );

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: partnerId },
        UpdateExpression: `SET webhooks = :webhooks, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':webhooks': updatedWebhooks,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async deleteWebhook(tenantId: string, partnerId: string, webhookId: string): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const webhookIndex = existing.webhooks.findIndex((w) => w.id === webhookId);
    if (webhookIndex === -1) {
      throw new AppError('WEBHOOK_NOT_FOUND', 'Webhook not found', 404);
    }

    const timestamp = now();
    const updatedWebhooks = existing.webhooks.filter((w) => w.id !== webhookId);

    const result = await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: partnerId },
        UpdateExpression: `SET webhooks = :webhooks, updatedAt = :updatedAt, #version = #version + :inc`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: {
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':webhooks': updatedWebhooks,
          ':updatedAt': timestamp,
          ':currentVersion': existing.version,
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    return result.Attributes as Partner;
  }

  async updateUsage(tenantId: string, partnerId: string, requestCount: number): Promise<void> {
    // This would typically update a usage tracking table or increment counters
    // For MVP, we'll just log it
    console.log(`Partner ${partnerId} usage: ${requestCount} requests`);
  }
}
