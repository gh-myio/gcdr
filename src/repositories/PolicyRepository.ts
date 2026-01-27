import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Policy } from '../domain/entities/Policy';
import { CreatePolicyDTO } from '../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../shared/types';
import { IPolicyRepository, UpdatePolicyDTO, ListPoliciesParams } from './interfaces/IPolicyRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { policies } = schema;

export class PolicyRepository implements IPolicyRepository {

  async create(tenantId: string, data: CreatePolicyDTO, createdBy: string): Promise<Policy> {
    // Check if key already exists
    const existing = await this.getByKey(tenantId, data.key);
    if (existing) {
      throw new AppError('POLICY_KEY_EXISTS', `Policy with key '${data.key}' already exists`, 409);
    }

    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(policies).values({
      id,
      tenantId,
      key: data.key,
      displayName: data.displayName,
      description: data.description || '',
      allow: data.allow || [],
      deny: data.deny || [],
      conditions: data.conditions || null,
      riskLevel: data.riskLevel || 'low',
      isSystem: false,
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Policy | null> {
    const [result] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.tenantId, tenantId), eq(policies.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByKey(tenantId: string, key: string): Promise<Policy | null> {
    const [result] = await db
      .select()
      .from(policies)
      .where(and(eq(policies.tenantId, tenantId), eq(policies.key, key)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByKeys(tenantId: string, keys: string[]): Promise<Policy[]> {
    if (keys.length === 0) {
      return [];
    }

    const results = await db
      .select()
      .from(policies)
      .where(and(
        eq(policies.tenantId, tenantId),
        inArray(policies.key, keys)
      ));

    return results.map(this.mapToEntity);
  }

  async update(tenantId: string, id: string, data: UpdatePolicyDTO, updatedBy: string): Promise<Policy> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('POLICY_NOT_FOUND', 'Policy not found', 404);
    }

    if (existing.isSystem) {
      throw new AppError('SYSTEM_POLICY', 'Cannot modify system policy', 403);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.allow !== undefined) updateData.allow = data.allow;
    if (data.deny !== undefined) updateData.deny = data.deny;
    if (data.conditions !== undefined) updateData.conditions = data.conditions;
    if (data.riskLevel !== undefined) updateData.riskLevel = data.riskLevel;

    const [result] = await db
      .update(policies)
      .set(updateData)
      .where(and(
        eq(policies.tenantId, tenantId),
        eq(policies.id, id),
        eq(policies.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Policy was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('POLICY_NOT_FOUND', 'Policy not found', 404);
    }

    if (existing.isSystem) {
      throw new AppError('SYSTEM_POLICY', 'Cannot delete system policy', 403);
    }

    await db
      .delete(policies)
      .where(and(eq(policies.tenantId, tenantId), eq(policies.id, id)));
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Policy>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const results = await db
      .select()
      .from(policies)
      .where(eq(policies.tenantId, tenantId))
      .orderBy(policies.createdAt)
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

  async listWithFilters(tenantId: string, params: ListPoliciesParams): Promise<PaginatedResult<Policy>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(policies.tenantId, tenantId)];

    if (params.riskLevel) {
      conditions.push(eq(policies.riskLevel, params.riskLevel as 'low' | 'medium' | 'high' | 'critical'));
    }

    if (params.isSystem !== undefined) {
      conditions.push(eq(policies.isSystem, params.isSystem));
    }

    const results = await db
      .select()
      .from(policies)
      .where(and(...conditions))
      .orderBy(policies.displayName)
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

  private mapToEntity(row: typeof policies.$inferSelect): Policy {
    return {
      id: row.id,
      tenantId: row.tenantId,
      key: row.key,
      displayName: row.displayName,
      description: row.description,
      allow: row.allow as string[],
      deny: row.deny as string[],
      conditions: row.conditions as Policy['conditions'],
      riskLevel: row.riskLevel,
      isSystem: row.isSystem,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
      version: row.version,
    };
  }
}

// Export singleton instance
export const policyRepository = new PolicyRepository();
