import { eq, and, or, isNull, ilike } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { DomainPermission, formatDomainPermissionKey } from '../domain/entities/DomainPermission';
import { CreateDomainPermissionDTO, UpdateDomainPermissionDTO } from '../dto/request/AccessBundleDTO';
import { PaginatedResult } from '../shared/types';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { domainPermissions } = schema;

export interface ListDomainPermissionsParams {
  domain?: string;
  equipment?: string;
  location?: string;
  action?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

export class DomainPermissionRepository {

  async create(tenantId: string | null, data: CreateDomainPermissionDTO): Promise<DomainPermission> {
    // Check if permission already exists
    const existing = await this.getByComponents(tenantId, data.domain, data.equipment, data.location, data.action);
    if (existing) {
      throw new AppError(
        'DOMAIN_PERMISSION_EXISTS',
        `Permission '${formatDomainPermissionKey(data)}' already exists`,
        409
      );
    }

    const id = generateId();
    const timestamp = now();

    const [result] = await db.insert(domainPermissions).values({
      id,
      tenantId,
      domain: data.domain,
      equipment: data.equipment,
      location: data.location,
      action: data.action,
      displayName: data.displayName || null,
      description: data.description || null,
      riskLevel: data.riskLevel || 'low',
      isActive: true,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
    }).returning();

    return this.mapToEntity(result);
  }

  async bulkCreate(tenantId: string | null, permissions: CreateDomainPermissionDTO[]): Promise<DomainPermission[]> {
    const results: DomainPermission[] = [];

    for (const perm of permissions) {
      try {
        const created = await this.create(tenantId, perm);
        results.push(created);
      } catch (error) {
        // Skip duplicates, throw other errors
        if (error instanceof AppError && error.code === 'DOMAIN_PERMISSION_EXISTS') {
          continue;
        }
        throw error;
      }
    }

    return results;
  }

  async getById(id: string): Promise<DomainPermission | null> {
    const [result] = await db
      .select()
      .from(domainPermissions)
      .where(eq(domainPermissions.id, id))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByComponents(
    tenantId: string | null,
    domain: string,
    equipment: string,
    location: string,
    action: string
  ): Promise<DomainPermission | null> {
    const [result] = await db
      .select()
      .from(domainPermissions)
      .where(and(
        tenantId ? eq(domainPermissions.tenantId, tenantId) : isNull(domainPermissions.tenantId),
        eq(domainPermissions.domain, domain),
        eq(domainPermissions.equipment, equipment),
        eq(domainPermissions.location, location),
        eq(domainPermissions.action, action)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(id: string, data: UpdateDomainPermissionDTO): Promise<DomainPermission> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('DOMAIN_PERMISSION_NOT_FOUND', 'Domain permission not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.riskLevel !== undefined) updateData.riskLevel = data.riskLevel;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const [result] = await db
      .update(domainPermissions)
      .set(updateData)
      .where(eq(domainPermissions.id, id))
      .returning();

    return this.mapToEntity(result);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('DOMAIN_PERMISSION_NOT_FOUND', 'Domain permission not found', 404);
    }

    await db
      .delete(domainPermissions)
      .where(eq(domainPermissions.id, id));
  }

  async list(tenantId: string | null, params?: ListDomainPermissionsParams): Promise<PaginatedResult<DomainPermission>> {
    const limit = params?.limit || 100;
    const offset = params?.offset || 0;

    // Include both tenant-specific and global (null tenantId) permissions
    const conditions = [
      or(
        tenantId ? eq(domainPermissions.tenantId, tenantId) : isNull(domainPermissions.tenantId),
        isNull(domainPermissions.tenantId)
      )!,
    ];

    if (params?.domain) {
      conditions.push(eq(domainPermissions.domain, params.domain));
    }

    if (params?.equipment) {
      conditions.push(eq(domainPermissions.equipment, params.equipment));
    }

    if (params?.location) {
      conditions.push(eq(domainPermissions.location, params.location));
    }

    if (params?.action) {
      conditions.push(eq(domainPermissions.action, params.action));
    }

    if (params?.isActive !== undefined) {
      conditions.push(eq(domainPermissions.isActive, params.isActive));
    }

    const results = await db
      .select()
      .from(domainPermissions)
      .where(and(...conditions))
      .orderBy(domainPermissions.domain, domainPermissions.equipment, domainPermissions.location, domainPermissions.action)
      .limit(limit + 1)
      .offset(offset);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;

    return {
      items: items.map(r => this.mapToEntity(r)),
      pagination: {
        hasMore,
        nextCursor: hasMore ? String(offset + limit) : undefined,
      },
    };
  }

  async listByDomain(tenantId: string | null, domain: string): Promise<DomainPermission[]> {
    const conditions = [
      or(
        tenantId ? eq(domainPermissions.tenantId, tenantId) : isNull(domainPermissions.tenantId),
        isNull(domainPermissions.tenantId)
      )!,
      eq(domainPermissions.domain, domain),
      eq(domainPermissions.isActive, true),
    ];

    const results = await db
      .select()
      .from(domainPermissions)
      .where(and(...conditions))
      .orderBy(domainPermissions.equipment, domainPermissions.location, domainPermissions.action);

    return results.map(r => this.mapToEntity(r));
  }

  async listDomains(tenantId: string | null): Promise<string[]> {
    const conditions = [
      or(
        tenantId ? eq(domainPermissions.tenantId, tenantId) : isNull(domainPermissions.tenantId),
        isNull(domainPermissions.tenantId)
      )!,
      eq(domainPermissions.isActive, true),
    ];

    const results = await db
      .selectDistinct({ domain: domainPermissions.domain })
      .from(domainPermissions)
      .where(and(...conditions))
      .orderBy(domainPermissions.domain);

    return results.map(r => r.domain);
  }

  async listEquipmentsByDomain(tenantId: string | null, domain: string): Promise<string[]> {
    const conditions = [
      or(
        tenantId ? eq(domainPermissions.tenantId, tenantId) : isNull(domainPermissions.tenantId),
        isNull(domainPermissions.tenantId)
      )!,
      eq(domainPermissions.domain, domain),
      eq(domainPermissions.isActive, true),
    ];

    const results = await db
      .selectDistinct({ equipment: domainPermissions.equipment })
      .from(domainPermissions)
      .where(and(...conditions))
      .orderBy(domainPermissions.equipment);

    return results.map(r => r.equipment);
  }

  async listLocationsByEquipment(tenantId: string | null, domain: string, equipment: string): Promise<string[]> {
    const conditions = [
      or(
        tenantId ? eq(domainPermissions.tenantId, tenantId) : isNull(domainPermissions.tenantId),
        isNull(domainPermissions.tenantId)
      )!,
      eq(domainPermissions.domain, domain),
      eq(domainPermissions.equipment, equipment),
      eq(domainPermissions.isActive, true),
    ];

    const results = await db
      .selectDistinct({ location: domainPermissions.location })
      .from(domainPermissions)
      .where(and(...conditions))
      .orderBy(domainPermissions.location);

    return results.map(r => r.location);
  }

  async getAllActive(tenantId: string | null): Promise<DomainPermission[]> {
    const conditions = [
      or(
        tenantId ? eq(domainPermissions.tenantId, tenantId) : isNull(domainPermissions.tenantId),
        isNull(domainPermissions.tenantId)
      )!,
      eq(domainPermissions.isActive, true),
    ];

    const results = await db
      .select()
      .from(domainPermissions)
      .where(and(...conditions))
      .orderBy(domainPermissions.domain, domainPermissions.equipment, domainPermissions.location, domainPermissions.action);

    return results.map(r => this.mapToEntity(r));
  }

  private mapToEntity(row: typeof domainPermissions.$inferSelect): DomainPermission {
    return {
      id: row.id,
      tenantId: row.tenantId || undefined,
      domain: row.domain,
      equipment: row.equipment,
      location: row.location,
      action: row.action,
      displayName: row.displayName || undefined,
      description: row.description || undefined,
      riskLevel: row.riskLevel,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// Export singleton instance
export const domainPermissionRepository = new DomainPermissionRepository();
