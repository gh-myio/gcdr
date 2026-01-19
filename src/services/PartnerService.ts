import { Partner, ApiKey, OAuthClient, WebhookSubscription } from '../domain/entities/Partner';
import {
  RegisterPartnerDTO,
  UpdatePartnerDTO,
  ApprovePartnerDTO,
  RejectPartnerDTO,
  CreateApiKeyDTO,
  CreateOAuthClientDTO,
  CreateWebhookDTO,
  UpdateWebhookDTO,
} from '../dto/request/PartnerDTO';
import { PartnerRepository } from '../repositories/PartnerRepository';
import { IPartnerRepository, ListPartnersParams } from '../repositories/interfaces/IPartnerRepository';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult, PartnerStatus } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors/AppError';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import * as crypto from 'crypto';

export class PartnerService {
  private repository: IPartnerRepository;

  constructor(repository?: IPartnerRepository) {
    this.repository = repository || new PartnerRepository();
  }

  async register(tenantId: string, data: RegisterPartnerDTO, registeredBy?: string): Promise<Partner> {
    // Check for existing partner with same email
    const existing = await this.repository.getByEmail(tenantId, data.contactEmail);
    if (existing) {
      throw new ConflictError(`Partner with email ${data.contactEmail} already exists`);
    }

    const partner = await this.repository.create(tenantId, data, registeredBy || 'self-registration');

    // Publish event
    await eventService.publish(EventType.PARTNER_REGISTERED, {
      tenantId,
      entityType: 'partner',
      entityId: partner.id,
      action: 'registered',
      data: {
        companyName: partner.companyName,
        contactEmail: partner.contactEmail,
      },
      actor: registeredBy ? { userId: registeredBy, type: 'user' } : { type: 'system' },
    });

    return partner;
  }

  async getById(tenantId: string, id: string): Promise<Partner> {
    const partner = await this.repository.getById(tenantId, id);
    if (!partner) {
      throw new NotFoundError(`Partner ${id} not found`);
    }
    return partner;
  }

  async update(tenantId: string, id: string, data: UpdatePartnerDTO, userId: string): Promise<Partner> {
    await this.getById(tenantId, id);

    const partner = await this.repository.update(tenantId, id, data, userId);

    await eventService.publish(EventType.PARTNER_UPDATED, {
      tenantId,
      entityType: 'partner',
      entityId: partner.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId, type: 'user' },
    });

    return partner;
  }

  async list(tenantId: string, params: ListPartnersParams): Promise<PaginatedResult<Partner>> {
    return this.repository.listWithFilters(tenantId, params);
  }

  async getByStatus(tenantId: string, status: PartnerStatus): Promise<Partner[]> {
    return this.repository.getByStatus(tenantId, status);
  }

  async getPendingPartners(tenantId: string): Promise<Partner[]> {
    return this.repository.getByStatus(tenantId, 'PENDING');
  }

  async approve(tenantId: string, id: string, data: ApprovePartnerDTO, approvedBy: string): Promise<Partner> {
    const partner = await this.getById(tenantId, id);

    if (partner.status !== 'PENDING') {
      throw new ValidationError(`Cannot approve partner with status ${partner.status}. Only PENDING partners can be approved.`);
    }

    const approvedPartner = await this.repository.approve(tenantId, id, data, approvedBy);

    await eventService.publish(EventType.PARTNER_APPROVED, {
      tenantId,
      entityType: 'partner',
      entityId: id,
      action: 'approved',
      data: {
        companyName: partner.companyName,
        scopes: data.scopes,
        rateLimits: {
          perMinute: data.rateLimitPerMinute,
          perDay: data.rateLimitPerDay,
          monthly: data.monthlyQuota,
        },
      },
      actor: { userId: approvedBy, type: 'user' },
    });

    return approvedPartner;
  }

  async reject(tenantId: string, id: string, data: RejectPartnerDTO, rejectedBy: string): Promise<Partner> {
    const partner = await this.getById(tenantId, id);

    if (partner.status !== 'PENDING') {
      throw new ValidationError(`Cannot reject partner with status ${partner.status}. Only PENDING partners can be rejected.`);
    }

    const rejectedPartner = await this.repository.reject(tenantId, id, data.reason, rejectedBy);

    await eventService.publish(EventType.PARTNER_REJECTED, {
      tenantId,
      entityType: 'partner',
      entityId: id,
      action: 'rejected',
      data: {
        companyName: partner.companyName,
        reason: data.reason,
      },
      actor: { userId: rejectedBy, type: 'user' },
    });

    return rejectedPartner;
  }

  async suspend(tenantId: string, id: string, reason: string, suspendedBy: string): Promise<Partner> {
    const partner = await this.getById(tenantId, id);

    if (partner.status !== 'ACTIVE' && partner.status !== 'APPROVED') {
      throw new ValidationError(`Cannot suspend partner with status ${partner.status}`);
    }

    const suspendedPartner = await this.repository.suspend(tenantId, id, reason, suspendedBy);

    await eventService.publish(EventType.PARTNER_SUSPENDED, {
      tenantId,
      entityType: 'partner',
      entityId: id,
      action: 'suspended',
      data: {
        companyName: partner.companyName,
        reason,
      },
      actor: { userId: suspendedBy, type: 'user' },
    });

    return suspendedPartner;
  }

  async activate(tenantId: string, id: string, activatedBy: string): Promise<Partner> {
    const partner = await this.getById(tenantId, id);

    if (partner.status !== 'APPROVED' && partner.status !== 'SUSPENDED') {
      throw new ValidationError(`Cannot activate partner with status ${partner.status}`);
    }

    const activatedPartner = await this.repository.activate(tenantId, id, activatedBy);

    await eventService.publish(EventType.PARTNER_ACTIVATED, {
      tenantId,
      entityType: 'partner',
      entityId: id,
      action: 'activated',
      data: {
        companyName: partner.companyName,
      },
      actor: { userId: activatedBy, type: 'user' },
    });

    return activatedPartner;
  }

  async createApiKey(
    tenantId: string,
    partnerId: string,
    data: CreateApiKeyDTO,
    createdBy: string
  ): Promise<{ partner: Partner; apiKey: string }> {
    const partner = await this.getById(tenantId, partnerId);

    if (partner.status !== 'ACTIVE' && partner.status !== 'APPROVED') {
      throw new ValidationError(`Cannot create API key for partner with status ${partner.status}`);
    }

    // Validate requested scopes are within partner's allowed scopes
    const invalidScopes = data.scopes.filter((s) => !partner.scopes.includes(s));
    if (invalidScopes.length > 0) {
      throw new ValidationError(`Invalid scopes: ${invalidScopes.join(', ')}. Partner is not authorized for these scopes.`);
    }

    // Generate API key
    const rawKey = this.generateApiKey();
    const keyHash = this.hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);

    const apiKey: ApiKey = {
      id: generateId(),
      keyHash,
      keyPrefix,
      name: data.name,
      scopes: data.scopes,
      expiresAt: data.expiresAt,
      createdAt: now(),
      status: 'ACTIVE',
    };

    const updatedPartner = await this.repository.addApiKey(tenantId, partnerId, apiKey);

    await eventService.publish(EventType.PARTNER_API_KEY_CREATED, {
      tenantId,
      entityType: 'partner',
      entityId: partnerId,
      action: 'api_key_created',
      data: {
        keyId: apiKey.id,
        keyName: apiKey.name,
        keyPrefix,
        scopes: apiKey.scopes,
      },
      actor: { userId: createdBy, type: 'user' },
    });

    // Return the raw key only once - it won't be stored
    return {
      partner: updatedPartner,
      apiKey: rawKey,
    };
  }

  async revokeApiKey(tenantId: string, partnerId: string, apiKeyId: string, revokedBy: string): Promise<Partner> {
    const partner = await this.getById(tenantId, partnerId);

    const apiKey = partner.apiKeys.find((k) => k.id === apiKeyId);
    if (!apiKey) {
      throw new NotFoundError(`API key ${apiKeyId} not found`);
    }

    if (apiKey.status === 'REVOKED') {
      throw new ValidationError('API key is already revoked');
    }

    const updatedPartner = await this.repository.revokeApiKey(tenantId, partnerId, apiKeyId);

    await eventService.publish(EventType.PARTNER_API_KEY_REVOKED, {
      tenantId,
      entityType: 'partner',
      entityId: partnerId,
      action: 'api_key_revoked',
      data: {
        keyId: apiKeyId,
        keyName: apiKey.name,
      },
      actor: { userId: revokedBy, type: 'user' },
    });

    return updatedPartner;
  }

  async rotateApiKey(
    tenantId: string,
    partnerId: string,
    apiKeyId: string,
    rotatedBy: string
  ): Promise<{ partner: Partner; newApiKey: string }> {
    const partner = await this.getById(tenantId, partnerId);

    const existingKey = partner.apiKeys.find((k) => k.id === apiKeyId);
    if (!existingKey) {
      throw new NotFoundError(`API key ${apiKeyId} not found`);
    }

    if (existingKey.status === 'REVOKED') {
      throw new ValidationError('Cannot rotate a revoked API key');
    }

    // Generate new API key with same settings
    const rawKey = this.generateApiKey();
    const keyHash = this.hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);

    const newApiKey: ApiKey = {
      id: generateId(),
      keyHash,
      keyPrefix,
      name: existingKey.name,
      scopes: existingKey.scopes,
      expiresAt: existingKey.expiresAt,
      createdAt: now(),
      status: 'ACTIVE',
    };

    // Revoke old key and add new one
    await this.repository.revokeApiKey(tenantId, partnerId, apiKeyId);
    const updatedPartner = await this.repository.addApiKey(tenantId, partnerId, newApiKey);

    await eventService.publish(EventType.PARTNER_API_KEY_CREATED, {
      tenantId,
      entityType: 'partner',
      entityId: partnerId,
      action: 'api_key_rotated',
      data: {
        oldKeyId: apiKeyId,
        newKeyId: newApiKey.id,
        keyName: newApiKey.name,
        keyPrefix,
      },
      actor: { userId: rotatedBy, type: 'user' },
    });

    return {
      partner: updatedPartner,
      newApiKey: rawKey,
    };
  }

  async validateApiKey(tenantId: string, apiKey: string): Promise<{ partner: Partner; keyInfo: ApiKey } | null> {
    const keyPrefix = apiKey.substring(0, 8);
    const keyHash = this.hashApiKey(apiKey);

    // Get all partners and check their keys
    // In production, this should use a dedicated API keys table with GSI
    const result = await this.repository.list(tenantId, { limit: 1000 });

    for (const partner of result.items) {
      const matchingKey = partner.apiKeys.find(
        (k) => k.keyPrefix === keyPrefix && k.keyHash === keyHash && k.status === 'ACTIVE'
      );

      if (matchingKey) {
        // Check expiration
        if (matchingKey.expiresAt && new Date(matchingKey.expiresAt) < new Date()) {
          return null;
        }

        // Update last used timestamp (fire and forget)
        this.updateApiKeyLastUsed(tenantId, partner.id, matchingKey.id).catch(() => {});

        return { partner, keyInfo: matchingKey };
      }
    }

    return null;
  }

  // ==================== OAuth Client Methods ====================

  async createOAuthClient(
    tenantId: string,
    partnerId: string,
    data: CreateOAuthClientDTO,
    createdBy: string
  ): Promise<{ partner: Partner; clientId: string; clientSecret: string }> {
    const partner = await this.getById(tenantId, partnerId);

    if (partner.status !== 'ACTIVE' && partner.status !== 'APPROVED') {
      throw new ValidationError(`Cannot create OAuth client for partner with status ${partner.status}`);
    }

    // Validate requested scopes
    const invalidScopes = data.scopes.filter((s) => !partner.scopes.includes(s));
    if (invalidScopes.length > 0) {
      throw new ValidationError(`Invalid scopes: ${invalidScopes.join(', ')}`);
    }

    // Generate client credentials
    const clientId = `gcdr_${generateId()}`;
    const clientSecret = this.generateClientSecret();
    const secretHash = this.hashApiKey(clientSecret);

    const oauthClient: OAuthClient = {
      clientId,
      clientSecretHash: secretHash,
      name: data.name,
      redirectUris: data.redirectUris || [],
      scopes: data.scopes,
      grantTypes: data.grantTypes,
      createdAt: now(),
      status: 'ACTIVE',
    };

    const updatedPartner = await this.repository.addOAuthClient(tenantId, partnerId, oauthClient);

    return {
      partner: updatedPartner,
      clientId,
      clientSecret,
    };
  }

  async revokeOAuthClient(tenantId: string, partnerId: string, clientId: string, revokedBy: string): Promise<Partner> {
    const partner = await this.getById(tenantId, partnerId);

    const client = partner.oauthClients.find((c) => c.clientId === clientId);
    if (!client) {
      throw new NotFoundError(`OAuth client ${clientId} not found`);
    }

    if (client.status === 'REVOKED') {
      throw new ValidationError('OAuth client is already revoked');
    }

    return this.repository.revokeOAuthClient(tenantId, partnerId, clientId);
  }

  async validateOAuthClient(
    clientId: string,
    clientSecret: string
  ): Promise<{ partner: Partner; client: OAuthClient } | null> {
    const secretHash = this.hashApiKey(clientSecret);

    // Get all partners and check their OAuth clients
    // In production, this should use a dedicated OAuth clients table
    const result = await this.repository.list('*', { limit: 1000 });

    for (const partner of result.items) {
      const matchingClient = partner.oauthClients.find(
        (c) => c.clientId === clientId && c.clientSecretHash === secretHash && c.status === 'ACTIVE'
      );

      if (matchingClient) {
        return { partner, client: matchingClient };
      }
    }

    return null;
  }

  async issueAccessToken(
    clientId: string,
    clientSecret: string,
    requestedScopes?: string[]
  ): Promise<{ accessToken: string; tokenType: string; expiresIn: number; scopes: string[] }> {
    const validation = await this.validateOAuthClient(clientId, clientSecret);

    if (!validation) {
      throw new ValidationError('Invalid client credentials');
    }

    const { partner, client } = validation;

    // Check partner status
    if (partner.status !== 'ACTIVE') {
      throw new ValidationError('Partner is not active');
    }

    // Validate requested scopes
    const grantedScopes = requestedScopes
      ? requestedScopes.filter((s) => client.scopes.includes(s))
      : client.scopes;

    // Generate access token (JWT in production)
    const tokenPayload = {
      partnerId: partner.id,
      tenantId: partner.tenantId,
      clientId,
      scopes: grantedScopes,
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      iat: Math.floor(Date.now() / 1000),
    };

    // For MVP, we generate a simple base64 encoded token
    // In production, this should be a signed JWT
    const accessToken = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');

    return {
      accessToken: `gcdr_oauth_${accessToken}`,
      tokenType: 'Bearer',
      expiresIn: 3600,
      scopes: grantedScopes,
    };
  }

  // ==================== Webhook Methods ====================

  async createWebhook(
    tenantId: string,
    partnerId: string,
    data: CreateWebhookDTO,
    createdBy: string
  ): Promise<{ partner: Partner; webhook: WebhookSubscription; secret?: string }> {
    const partner = await this.getById(tenantId, partnerId);

    if (partner.status !== 'ACTIVE' && partner.status !== 'APPROVED') {
      throw new ValidationError(`Cannot create webhook for partner with status ${partner.status}`);
    }

    // Generate or use provided secret
    const secret = data.secret || this.generateWebhookSecret();
    const secretHash = this.hashApiKey(secret);

    const webhook: WebhookSubscription = {
      id: generateId(),
      url: data.url,
      events: data.events,
      secretHash,
      enabled: data.enabled,
      createdAt: now(),
      updatedAt: now(),
      failureCount: 0,
    };

    const updatedPartner = await this.repository.addWebhook(tenantId, partnerId, webhook);

    return {
      partner: updatedPartner,
      webhook,
      secret: data.secret ? undefined : secret, // Only return if we generated it
    };
  }

  async updateWebhook(
    tenantId: string,
    partnerId: string,
    webhookId: string,
    data: UpdateWebhookDTO,
    updatedBy: string
  ): Promise<Partner> {
    const partner = await this.getById(tenantId, partnerId);

    const webhook = partner.webhooks.find((w) => w.id === webhookId);
    if (!webhook) {
      throw new NotFoundError(`Webhook ${webhookId} not found`);
    }

    return this.repository.updateWebhook(tenantId, partnerId, webhookId, data);
  }

  async deleteWebhook(tenantId: string, partnerId: string, webhookId: string, deletedBy: string): Promise<Partner> {
    const partner = await this.getById(tenantId, partnerId);

    const webhook = partner.webhooks.find((w) => w.id === webhookId);
    if (!webhook) {
      throw new NotFoundError(`Webhook ${webhookId} not found`);
    }

    return this.repository.deleteWebhook(tenantId, partnerId, webhookId);
  }

  async listWebhooks(tenantId: string, partnerId: string): Promise<WebhookSubscription[]> {
    const partner = await this.getById(tenantId, partnerId);
    return partner.webhooks;
  }

  private async updateApiKeyLastUsed(tenantId: string, partnerId: string, keyId: string): Promise<void> {
    // This would update the lastUsedAt field on the API key
    // For MVP, we'll skip the actual update
    console.log(`API key ${keyId} used by partner ${partnerId}`);
  }

  private generateApiKey(): string {
    // Generate a secure random API key: gcdr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
    const randomBytes = crypto.randomBytes(24);
    return `gcdr_live_${randomBytes.toString('hex')}`;
  }

  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
  }

  private generateClientSecret(): string {
    const randomBytes = crypto.randomBytes(32);
    return `gcdr_secret_${randomBytes.toString('hex')}`;
  }

  private generateWebhookSecret(): string {
    const randomBytes = crypto.randomBytes(32);
    return `whsec_${randomBytes.toString('hex')}`;
  }
}

export const partnerService = new PartnerService();
