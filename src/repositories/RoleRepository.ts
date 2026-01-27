import { eq, and, inArray } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Role } from '../domain/entities/Role';
import { CreateRoleDTO, UpdateRoleDTO } from '../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../shared/types';
import { IRoleRepository, ListRolesParams } from './interfaces/IRoleRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { roles } = schema;

export class RoleRepository implements IRoleRepository {

  async create(tenantId: string, data: CreateRoleDTO, createdBy: string): Promise<Role> {
    // Check if key already exists
    const existing = await this.getByKey(tenantId, data.key);
    if (existing) {
      throw new AppError('ROLE_KEY_EXISTS', `Role with key '${data.key}' already exists`, 409);
    }

    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(roles).values({
      id,
      tenantId,
      key: data.key,
      displayName: data.displayName,
      description: data.description || '',
      policies: data.policies,
      tags: data.tags || [],
      riskLevel: data.riskLevel || 'low',
      isSystem: false,
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Role | null> {
    const [result] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByKey(tenantId: string, key: string): Promise<Role | null> {
    const [result] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByKeys(tenantId: string, keys: string[]): Promise<Role[]> {
    if (keys.length === 0) {
      return [];
    }

    const results = await db
      .select()
      .from(roles)
      .where(and(
        eq(roles.tenantId, tenantId),
        inArray(roles.key, keys)
      ));

    return results.map(this.mapToEntity);
  }

  async update(tenantId: string, id: string, data: UpdateRoleDTO, updatedBy: string): Promise<Role> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('ROLE_NOT_FOUND', 'Role not found', 404);
    }

    if (existing.isSystem) {
      throw new AppError('SYSTEM_ROLE', 'Cannot modify system role', 403);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.policies !== undefined) updateData.policies = data.policies;
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.riskLevel !== undefined) updateData.riskLevel = data.riskLevel;

    const [result] = await db
      .update(roles)
      .set(updateData)
      .where(and(
        eq(roles.tenantId, tenantId),
        eq(roles.id, id),
        eq(roles.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Role was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('ROLE_NOT_FOUND', 'Role not found', 404);
    }

    if (existing.isSystem) {
      throw new AppError('SYSTEM_ROLE', 'Cannot delete system role', 403);
    }

    await db
      .delete(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, id)));
  }

  async list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<Role>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    const results = await db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, tenantId))
      .orderBy(roles.createdAt)
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

  async listWithFilters(tenantId: string, params: ListRolesParams): Promise<PaginatedResult<Role>> {
    const limit = params.limit || 20;
    const offset = params.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(roles.tenantId, tenantId)];

    if (params.riskLevel) {
      conditions.push(eq(roles.riskLevel, params.riskLevel as 'low' | 'medium' | 'high' | 'critical'));
    }

    if (params.isSystem !== undefined) {
      conditions.push(eq(roles.isSystem, params.isSystem));
    }

    const results = await db
      .select()
      .from(roles)
      .where(and(...conditions))
      .orderBy(roles.displayName)
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

  private mapToEntity(row: typeof roles.$inferSelect): Role {
    return {
      id: row.id,
      tenantId: row.tenantId,
      key: row.key,
      displayName: row.displayName,
      description: row.description,
      policies: row.policies as string[],
      tags: row.tags as string[],
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
export const roleRepository = new RoleRepository();
