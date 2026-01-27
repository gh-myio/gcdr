import { eq, and, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { CustomerApiKey } from '../domain/entities/CustomerApiKey';
import { ICustomerApiKeyRepository } from './interfaces/ICustomerApiKeyRepository';
import { PaginatedResult, PaginationParams } from '../shared/types';

const { customerApiKeys } = schema;

export class CustomerApiKeyRepository implements ICustomerApiKeyRepository {

  async create(apiKey: CustomerApiKey): Promise<CustomerApiKey> {
    const [result] = await db.insert(customerApiKeys).values({
      id: apiKey.id,
      tenantId: apiKey.tenantId,
      customerId: apiKey.customerId,
      keyHash: apiKey.keyHash,
      keyPrefix: apiKey.keyPrefix,
      name: apiKey.name,
      description: apiKey.description || null,
      scopes: apiKey.scopes || [],
      expiresAt: apiKey.expiresAt ? new Date(apiKey.expiresAt) : null,
      lastUsedAt: apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt) : null,
      lastUsedIp: apiKey.lastUsedIp || null,
      usageCount: apiKey.usageCount || 0,
      isActive: apiKey.isActive ?? true,
      version: 1,
      createdAt: new Date(apiKey.createdAt),
      updatedAt: new Date(apiKey.updatedAt),
      createdBy: apiKey.createdBy || null,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<CustomerApiKey | null> {
    const [result] = await db
      .select()
      .from(customerApiKeys)
      .where(and(eq(customerApiKeys.tenantId, tenantId), eq(customerApiKeys.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByKeyHash(tenantId: string, keyHash: string): Promise<CustomerApiKey | null> {
    const [result] = await db
      .select()
      .from(customerApiKeys)
      .where(and(
        eq(customerApiKeys.tenantId, tenantId),
        eq(customerApiKeys.keyHash, keyHash)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async listByCustomer(
    tenantId: string,
    customerId: string,
    options?: PaginationParams & { isActive?: boolean }
  ): Promise<PaginatedResult<CustomerApiKey>> {
    const limit = options?.limit || 20;
    const offset = options?.cursor ? parseInt(options.cursor, 10) : 0;

    // Build conditions
    const conditions = [
      eq(customerApiKeys.tenantId, tenantId),
      eq(customerApiKeys.customerId, customerId),
    ];

    if (options?.isActive !== undefined) {
      conditions.push(eq(customerApiKeys.isActive, options.isActive));
    }

    const results = await db
      .select()
      .from(customerApiKeys)
      .where(and(...conditions))
      .orderBy(customerApiKeys.createdAt)
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

  async update(apiKey: CustomerApiKey): Promise<CustomerApiKey> {
    const now = new Date().toISOString();

    const [result] = await db
      .update(customerApiKeys)
      .set({
        name: apiKey.name,
        description: apiKey.description || null,
        scopes: apiKey.scopes || [],
        expiresAt: apiKey.expiresAt ? new Date(apiKey.expiresAt) : null,
        isActive: apiKey.isActive,
        updatedAt: new Date(now),
        updatedBy: apiKey.updatedBy || null,
      })
      .where(and(
        eq(customerApiKeys.tenantId, apiKey.tenantId),
        eq(customerApiKeys.id, apiKey.id)
      ))
      .returning();

    if (!result) {
      // If no result, return the input with updated timestamp
      return {
        ...apiKey,
        updatedAt: now,
      };
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await db
      .delete(customerApiKeys)
      .where(and(eq(customerApiKeys.tenantId, tenantId), eq(customerApiKeys.id, id)));
  }

  async updateLastUsed(tenantId: string, id: string, ip: string): Promise<void> {
    const now = new Date();

    await db
      .update(customerApiKeys)
      .set({
        lastUsedAt: now,
        lastUsedIp: ip,
        updatedAt: now,
      })
      .where(and(eq(customerApiKeys.tenantId, tenantId), eq(customerApiKeys.id, id)));
  }

  async incrementUsageCount(tenantId: string, id: string): Promise<void> {
    await db
      .update(customerApiKeys)
      .set({
        usageCount: sql`${customerApiKeys.usageCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(customerApiKeys.tenantId, tenantId), eq(customerApiKeys.id, id)));
  }

  private mapToEntity(row: typeof customerApiKeys.$inferSelect): CustomerApiKey {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      keyHash: row.keyHash,
      keyPrefix: row.keyPrefix,
      name: row.name,
      description: row.description || undefined,
      scopes: row.scopes as CustomerApiKey['scopes'],
      expiresAt: row.expiresAt?.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString(),
      lastUsedIp: row.lastUsedIp || undefined,
      usageCount: row.usageCount,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
      version: row.version,
    };
  }
}

// Export singleton instance
export const customerApiKeyRepository = new CustomerApiKeyRepository();
