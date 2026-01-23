import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Partner, ApiKey, OAuthClient, WebhookSubscription } from '../domain/entities/Partner';
import { RegisterPartnerDTO, UpdatePartnerDTO, ApprovePartnerDTO, UpdateWebhookDTO } from '../dto/request/PartnerDTO';
import { PaginatedResult, PartnerStatus } from '../shared/types';
import { IPartnerRepository, ListPartnersParams } from './interfaces/IPartnerRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { partners } = schema;

export class PartnerRepository implements IPartnerRepository {

  async create(tenantId: string, data: RegisterPartnerDTO, createdBy: string): Promise<Partner> {
    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(partners).values({
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
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Partner | null> {
    const [result] = await db
      .select()
      .from(partners)
      .where(and(eq(partners.tenantId, tenantId), eq(partners.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByEmail(tenantId: string, email: string): Promise<Partner | null> {
    const [result] = await db
      .select()
      .from(partners)
      .where(and(eq(partners.tenantId, tenantId), eq(partners.contactEmail, email)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdatePartnerDTO, updatedBy: string): Promise<Partner> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.companyName !== undefined) updateData.companyName = data.companyName;
    if (data.companyWebsite !== undefined) updateData.companyWebsite = data.companyWebsite;
    if (data.companyDescription !== undefined) updateData.companyDescription = data.companyDescription;
    if (data.industry !== undefined) updateData.industry = data.industry;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.contactName !== undefined) updateData.contactName = data.contactName;
    if (data.contactEmail !== undefined) updateData.contactEmail = data.contactEmail;
    if (data.contactPhone !== undefined) updateData.contactPhone = data.contactPhone;
    if (data.technicalContactEmail !== undefined) updateData.technicalContactEmail = data.technicalContactEmail;
    if (data.webhookUrl !== undefined) updateData.webhookUrl = data.webhookUrl;
    if (data.ipWhitelist !== undefined) updateData.ipWhitelist = data.ipWhitelist;

    const [result] = await db
      .update(partners)
      .set(updateData)
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, id),
        eq(partners.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(partners)
      .where(and(eq(partners.tenantId, tenantId), eq(partners.id, id)));
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Partner>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const results = await db
      .select()
      .from(partners)
      .where(eq(partners.tenantId, tenantId))
      .orderBy(partners.createdAt)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async listWithFilters(tenantId: string, params: ListPartnersParams): Promise<PaginatedResult<Partner>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(partners.tenantId, tenantId)];

    if (params.status) {
      conditions.push(eq(partners.status, params.status));
    }

    const results = await db
      .select()
      .from(partners)
      .where(and(...conditions))
      .orderBy(partners.companyName)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(this.mapToEntity),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async getByStatus(tenantId: string, status: PartnerStatus): Promise<Partner[]> {
    const results = await db
      .select()
      .from(partners)
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.status, status)
      ))
      .orderBy(partners.companyName);

    return results.map(this.mapToEntity);
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

    const [result] = await db
      .update(partners)
      .set({
        status: 'APPROVED',
        scopes: data.scopes,
        rateLimitPerMinute: data.rateLimitPerMinute,
        rateLimitPerDay: data.rateLimitPerDay,
        monthlyQuota: data.monthlyQuota,
        approvedAt: new Date(timestamp),
        approvedBy,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, id),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
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

    const [result] = await db
      .update(partners)
      .set({
        status: 'REJECTED',
        rejectedAt: new Date(timestamp),
        rejectedBy,
        rejectionReason: reason,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, id),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
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

    const [result] = await db
      .update(partners)
      .set({
        status: 'SUSPENDED',
        suspendedAt: new Date(timestamp),
        suspendedBy,
        suspensionReason: reason,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, id),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
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

    const [result] = await db
      .update(partners)
      .set({
        status: 'ACTIVE',
        activatedAt: new Date(timestamp),
        activatedBy,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, id),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async addApiKey(tenantId: string, partnerId: string, apiKey: ApiKey): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const timestamp = now();
    const updatedApiKeys = [...existing.apiKeys, apiKey];

    const [result] = await db
      .update(partners)
      .set({
        apiKeys: updatedApiKeys,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, partnerId),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
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

    const [result] = await db
      .update(partners)
      .set({
        apiKeys: updatedApiKeys,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, partnerId),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async addOAuthClient(tenantId: string, partnerId: string, client: OAuthClient): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const timestamp = now();
    const updatedClients = [...existing.oauthClients, client];

    const [result] = await db
      .update(partners)
      .set({
        oauthClients: updatedClients,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, partnerId),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
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

    const [result] = await db
      .update(partners)
      .set({
        oauthClients: updatedClients,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, partnerId),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async addWebhook(tenantId: string, partnerId: string, webhook: WebhookSubscription): Promise<Partner> {
    const existing = await this.getById(tenantId, partnerId);
    if (!existing) {
      throw new AppError('PARTNER_NOT_FOUND', 'Partner not found', 404);
    }

    const timestamp = now();
    const updatedWebhooks = [...existing.webhooks, webhook];

    const [result] = await db
      .update(partners)
      .set({
        webhooks: updatedWebhooks,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, partnerId),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
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

    const [result] = await db
      .update(partners)
      .set({
        webhooks: updatedWebhooks,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, partnerId),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
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

    const [result] = await db
      .update(partners)
      .set({
        webhooks: updatedWebhooks,
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(partners.tenantId, tenantId),
        eq(partners.id, partnerId),
        eq(partners.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Partner was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async updateUsage(tenantId: string, partnerId: string, requestCount: number): Promise<void> {
    // This would typically update a usage tracking table or increment counters
    // For MVP, we'll just log it
    console.log(`Partner ${partnerId} usage: ${requestCount} requests`);
  }

  private mapToEntity(row: typeof partners.$inferSelect): Partner {
    return {
      id: row.id,
      tenantId: row.tenantId,
      status: row.status,
      companyName: row.companyName,
      companyWebsite: row.companyWebsite,
      companyDescription: row.companyDescription,
      industry: row.industry,
      country: row.country,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone || undefined,
      technicalContactEmail: row.technicalContactEmail,
      webhookUrl: row.webhookUrl || undefined,
      ipWhitelist: row.ipWhitelist as string[] | undefined,
      apiKeys: row.apiKeys as ApiKey[],
      oauthClients: row.oauthClients as OAuthClient[],
      webhooks: row.webhooks as WebhookSubscription[],
      scopes: row.scopes as string[],
      rateLimitPerMinute: row.rateLimitPerMinute,
      rateLimitPerDay: row.rateLimitPerDay,
      monthlyQuota: row.monthlyQuota,
      subscribedPackages: row.subscribedPackages as string[],
      publishedPackages: row.publishedPackages as string[],
      approvedAt: row.approvedAt?.toISOString(),
      approvedBy: row.approvedBy || undefined,
      rejectedAt: row.rejectedAt?.toISOString(),
      rejectedBy: row.rejectedBy || undefined,
      rejectionReason: row.rejectionReason || undefined,
      suspendedAt: row.suspendedAt?.toISOString(),
      suspendedBy: row.suspendedBy || undefined,
      suspensionReason: row.suspensionReason || undefined,
      activatedAt: row.activatedAt?.toISOString(),
      activatedBy: row.activatedBy || undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
      version: row.version,
    };
  }
}

// Export singleton instance
export const partnerRepository = new PartnerRepository();
