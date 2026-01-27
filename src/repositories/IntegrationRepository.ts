import { eq, and, sql, ilike, gt } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import {
  IntegrationPackage,
  PackageSubscription,
  PackageStatus,
  PackageVersion,
} from '../domain/entities/IntegrationPackage';
import { CreatePackageDTO, UpdatePackageDTO, SearchPackagesDTO } from '../dto/request/IntegrationDTO';
import { PaginatedResult } from '../shared/types';
import { IIntegrationPackageRepository, ISubscriptionRepository } from './interfaces/IIntegrationRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { integrationPackages, packageSubscriptions } = schema;

export class IntegrationPackageRepository implements IIntegrationPackageRepository {

  async create(
    tenantId: string,
    data: CreatePackageDTO,
    publisherId: string,
    publisherName: string
  ): Promise<IntegrationPackage> {
    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(integrationPackages).values({
      id,
      tenantId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      longDescription: data.longDescription || null,
      category: data.category,
      tags: data.tags || [],
      iconUrl: data.iconUrl || null,
      documentationUrl: data.documentationUrl || null,
      type: data.type,
      status: 'DRAFT',
      currentVersion: '0.0.0',
      versions: [],
      publisherId,
      publisherName,
      verified: false,
      scopes: data.scopes || [],
      capabilities: data.capabilities || [],
      endpoints: data.endpoints || [],
      events: data.events || [],
      auth: data.auth || {},
      rateLimits: data.rateLimits || {},
      pricing: data.pricing || {},
      subscriberCount: 0,
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy: publisherId,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<IntegrationPackage | null> {
    const [result] = await db
      .select()
      .from(integrationPackages)
      .where(and(eq(integrationPackages.tenantId, tenantId), eq(integrationPackages.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getBySlug(tenantId: string, slug: string): Promise<IntegrationPackage | null> {
    const [result] = await db
      .select()
      .from(integrationPackages)
      .where(and(
        eq(integrationPackages.tenantId, tenantId),
        eq(integrationPackages.slug, slug)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
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

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.longDescription !== undefined) updateData.longDescription = data.longDescription;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.iconUrl !== undefined) updateData.iconUrl = data.iconUrl;
    if (data.documentationUrl !== undefined) updateData.documentationUrl = data.documentationUrl;
    if (data.capabilities !== undefined) updateData.capabilities = data.capabilities;
    if (data.endpoints !== undefined) updateData.endpoints = data.endpoints;
    if (data.events !== undefined) updateData.events = data.events;
    if (data.auth !== undefined) updateData.auth = data.auth;
    if (data.rateLimits !== undefined) updateData.rateLimits = data.rateLimits;
    if (data.pricing !== undefined) updateData.pricing = data.pricing;

    const [result] = await db
      .update(integrationPackages)
      .set(updateData)
      .where(and(
        eq(integrationPackages.tenantId, tenantId),
        eq(integrationPackages.id, id),
        eq(integrationPackages.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Package was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(integrationPackages)
      .where(and(eq(integrationPackages.tenantId, tenantId), eq(integrationPackages.id, id)));
  }

  async search(tenantId: string, params: SearchPackagesDTO): Promise<PaginatedResult<IntegrationPackage>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [
      eq(integrationPackages.tenantId, tenantId),
      eq(integrationPackages.status, (params.status || 'PUBLISHED') as PackageStatus),
    ];

    if (params.category) {
      conditions.push(eq(integrationPackages.category, params.category));
    }

    if (params.type) {
      conditions.push(eq(integrationPackages.type, params.type));
    }

    if (params.verified !== undefined) {
      conditions.push(eq(integrationPackages.verified, params.verified));
    }

    if (params.query) {
      conditions.push(
        sql`(${integrationPackages.name} ILIKE ${`%${params.query}%`} OR ${integrationPackages.description} ILIKE ${`%${params.query}%`})`
      );
    }

    // Note: pricing filter would need JSONB operator
    // For simplicity, we'll filter in memory if needed

    const results = await db
      .select()
      .from(integrationPackages)
      .where(and(...conditions))
      .orderBy(integrationPackages.name)
      .limit(limit + 1)
      .offset(offset);

    let filteredResults = results;

    // Filter by pricing model if specified
    if (params.pricing) {
      filteredResults = filteredResults.filter(pkg => {
        const pricing = pkg.pricing as { model?: string };
        return pricing && pricing.model === params.pricing;
      });
    }

    const hasMore = filteredResults.length > limit;
    let items = hasMore ? filteredResults.slice(0, limit) : filteredResults;

    // Sort if specified
    if (params.sortBy) {
      items = [...items].sort((a, b) => {
        const aVal = a[params.sortBy as keyof typeof a];
        const bVal = b[params.sortBy as keyof typeof b];
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
      items: items.map(this.mapToEntity),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async listByPublisher(tenantId: string, publisherId: string): Promise<IntegrationPackage[]> {
    const results = await db
      .select()
      .from(integrationPackages)
      .where(and(
        eq(integrationPackages.tenantId, tenantId),
        eq(integrationPackages.publisherId, publisherId)
      ))
      .orderBy(integrationPackages.name);

    return results.map(this.mapToEntity);
  }

  async listByStatus(tenantId: string, status: PackageStatus): Promise<IntegrationPackage[]> {
    const results = await db
      .select()
      .from(integrationPackages)
      .where(and(
        eq(integrationPackages.tenantId, tenantId),
        eq(integrationPackages.status, status)
      ))
      .orderBy(integrationPackages.name);

    return results.map(this.mapToEntity);
  }

  async listByCategory(tenantId: string, category: string): Promise<IntegrationPackage[]> {
    const results = await db
      .select()
      .from(integrationPackages)
      .where(and(
        eq(integrationPackages.tenantId, tenantId),
        eq(integrationPackages.category, category),
        eq(integrationPackages.status, 'PUBLISHED')
      ))
      .orderBy(integrationPackages.name);

    return results.map(this.mapToEntity);
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

    const [result] = await db
      .update(integrationPackages)
      .set({
        status,
        updatedAt: new Date(timestamp),
        updatedBy,
        version: existing.version + 1,
      })
      .where(and(
        eq(integrationPackages.tenantId, tenantId),
        eq(integrationPackages.id, id),
        eq(integrationPackages.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Package was modified by another process', 409);
    }

    return this.mapToEntity(result);
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

    const updatedVersions = [...(existing.versions || []), newVersion];

    const [result] = await db
      .update(integrationPackages)
      .set({
        currentVersion: version,
        versions: updatedVersions,
        status: 'PUBLISHED',
        publishedAt: new Date(timestamp),
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(integrationPackages.tenantId, tenantId),
        eq(integrationPackages.id, id),
        eq(integrationPackages.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Package was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async deprecate(tenantId: string, id: string, reason: string): Promise<IntegrationPackage> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('PACKAGE_NOT_FOUND', 'Integration package not found', 404);
    }

    const timestamp = now();

    const [result] = await db
      .update(integrationPackages)
      .set({
        status: 'DEPRECATED',
        deprecatedAt: new Date(timestamp),
        updatedAt: new Date(timestamp),
        version: existing.version + 1,
      })
      .where(and(
        eq(integrationPackages.tenantId, tenantId),
        eq(integrationPackages.id, id),
        eq(integrationPackages.version, existing.version)
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Package was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async incrementSubscriberCount(tenantId: string, id: string): Promise<void> {
    await db
      .update(integrationPackages)
      .set({
        subscriberCount: sql`${integrationPackages.subscriberCount} + 1`,
      })
      .where(and(eq(integrationPackages.tenantId, tenantId), eq(integrationPackages.id, id)));
  }

  async decrementSubscriberCount(tenantId: string, id: string): Promise<void> {
    await db
      .update(integrationPackages)
      .set({
        subscriberCount: sql`GREATEST(${integrationPackages.subscriberCount} - 1, 0)`,
      })
      .where(and(eq(integrationPackages.tenantId, tenantId), eq(integrationPackages.id, id)));
  }

  private mapToEntity(row: typeof integrationPackages.$inferSelect): IntegrationPackage {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      longDescription: row.longDescription || undefined,
      category: row.category,
      tags: row.tags as string[],
      iconUrl: row.iconUrl || undefined,
      documentationUrl: row.documentationUrl || undefined,
      type: row.type,
      status: row.status,
      currentVersion: row.currentVersion,
      versions: row.versions as PackageVersion[],
      publisherId: row.publisherId,
      publisherName: row.publisherName,
      verified: row.verified,
      scopes: row.scopes as string[],
      capabilities: row.capabilities as IntegrationPackage['capabilities'],
      endpoints: row.endpoints as IntegrationPackage['endpoints'],
      events: row.events as IntegrationPackage['events'],
      auth: row.auth as IntegrationPackage['auth'],
      rateLimits: row.rateLimits as IntegrationPackage['rateLimits'],
      pricing: row.pricing as IntegrationPackage['pricing'],
      subscriberCount: row.subscriberCount,
      reviewedAt: row.reviewedAt?.toISOString(),
      reviewedBy: row.reviewedBy || undefined,
      rejectionReason: row.rejectionReason || undefined,
      publishedAt: row.publishedAt?.toISOString(),
      deprecatedAt: row.deprecatedAt?.toISOString(),
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
    };
  }
}

export class SubscriptionRepository implements ISubscriptionRepository {

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

    const [result] = await db.insert(packageSubscriptions).values({
      id,
      tenantId,
      packageId,
      packageVersion,
      subscriberId,
      subscriberType,
      status: 'ACTIVE',
      subscribedAt: new Date(timestamp),
      config: config || null,
      usageStats: {
        requestCount: 0,
        monthlyUsage: 0,
      },
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<PackageSubscription | null> {
    const [result] = await db
      .select()
      .from(packageSubscriptions)
      .where(and(eq(packageSubscriptions.tenantId, tenantId), eq(packageSubscriptions.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByPackageAndSubscriber(
    tenantId: string,
    packageId: string,
    subscriberId: string
  ): Promise<PackageSubscription | null> {
    const [result] = await db
      .select()
      .from(packageSubscriptions)
      .where(and(
        eq(packageSubscriptions.tenantId, tenantId),
        eq(packageSubscriptions.packageId, packageId),
        eq(packageSubscriptions.subscriberId, subscriberId)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(
    tenantId: string,
    id: string,
    data: { version?: string; config?: Record<string, unknown>; status?: string }
  ): Promise<PackageSubscription> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.version !== undefined) updateData.packageVersion = data.version;
    if (data.config !== undefined) updateData.config = data.config;
    if (data.status !== undefined) updateData.status = data.status;

    if (Object.keys(updateData).length === 1) {
      const existing = await this.getById(tenantId, id);
      if (!existing) {
        throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
      }
      return existing;
    }

    const [result] = await db
      .update(packageSubscriptions)
      .set(updateData)
      .where(and(eq(packageSubscriptions.tenantId, tenantId), eq(packageSubscriptions.id, id)))
      .returning();

    if (!result) {
      throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(packageSubscriptions)
      .where(and(eq(packageSubscriptions.tenantId, tenantId), eq(packageSubscriptions.id, id)));
  }

  async listBySubscriber(tenantId: string, subscriberId: string): Promise<PackageSubscription[]> {
    const results = await db
      .select()
      .from(packageSubscriptions)
      .where(and(
        eq(packageSubscriptions.tenantId, tenantId),
        eq(packageSubscriptions.subscriberId, subscriberId)
      ));

    return results.map(this.mapToEntity);
  }

  async listByPackage(tenantId: string, packageId: string): Promise<PackageSubscription[]> {
    const results = await db
      .select()
      .from(packageSubscriptions)
      .where(and(
        eq(packageSubscriptions.tenantId, tenantId),
        eq(packageSubscriptions.packageId, packageId)
      ));

    return results.map(this.mapToEntity);
  }

  async updateUsageStats(tenantId: string, id: string, requestCount: number): Promise<void> {
    const timestamp = now();
    const existing = await this.getById(tenantId, id);

    if (!existing) {
      throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', 404);
    }

    const updatedStats = {
      ...existing.usageStats,
      requestCount: (existing.usageStats?.requestCount || 0) + requestCount,
      monthlyUsage: (existing.usageStats?.monthlyUsage || 0) + requestCount,
      lastRequestAt: timestamp,
    };

    await db
      .update(packageSubscriptions)
      .set({
        usageStats: updatedStats,
        updatedAt: new Date(timestamp),
      })
      .where(and(eq(packageSubscriptions.tenantId, tenantId), eq(packageSubscriptions.id, id)));
  }

  private mapToEntity(row: typeof packageSubscriptions.$inferSelect): PackageSubscription {
    return {
      id: row.id,
      packageId: row.packageId,
      packageVersion: row.packageVersion,
      subscriberId: row.subscriberId,
      subscriberType: row.subscriberType as 'partner' | 'customer',
      status: row.status as 'ACTIVE' | 'SUSPENDED' | 'CANCELLED',
      subscribedAt: row.subscribedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      config: row.config as Record<string, unknown> | undefined,
      usageStats: row.usageStats as PackageSubscription['usageStats'],
    };
  }
}

// Export singleton instances
export const integrationPackageRepository = new IntegrationPackageRepository();
export const subscriptionRepository = new SubscriptionRepository();
