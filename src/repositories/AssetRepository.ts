import { eq, and, like, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../infrastructure/database/drizzle/db';
import { Asset } from '../domain/entities/Asset';
import { CreateAssetDTO, UpdateAssetDTO, ListAssetsParams } from '../dto/request/AssetDTO';
import { PaginatedResult } from '../shared/types';
import { IAssetRepository, AssetTreeNode } from './interfaces/IAssetRepository';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

const { assets } = schema;

export class AssetRepository implements IAssetRepository {

  async create(tenantId: string, data: CreateAssetDTO, createdBy: string): Promise<Asset> {
    const id = generateId();
    const timestamp = now();

    // Calculate path and depth based on parent
    let path: string;
    let depth: number;

    if (data.parentAssetId) {
      const parent = await this.getById(tenantId, data.parentAssetId);
      if (!parent) {
        throw new AppError('PARENT_NOT_FOUND', 'Parent asset not found', 404);
      }
      if (parent.customerId !== data.customerId) {
        throw new AppError('INVALID_PARENT', 'Parent asset must belong to the same customer', 400);
      }
      path = `${parent.path}/${id}`;
      depth = parent.depth + 1;
    } else {
      path = `/${tenantId}/${data.customerId}/${id}`;
      depth = 0;
    }

    // Generate code if not provided
    const code = data.code || this.generateCode(data.name);

    const [result] = await db.insert(assets).values({
      id,
      tenantId,
      customerId: data.customerId,
      parentAssetId: data.parentAssetId || null,
      path,
      depth,
      name: data.name,
      displayName: data.displayName || data.name,
      code,
      type: data.type,
      description: data.description,
      location: data.location || {},
      specs: data.specs || {},
      tags: data.tags || [],
      metadata: data.metadata || {},
      status: 'ACTIVE',
      version: 1,
      createdAt: new Date(timestamp),
      updatedAt: new Date(timestamp),
      createdBy,
    }).returning();

    return this.mapToEntity(result);
  }

  async getById(tenantId: string, id: string): Promise<Asset | null> {
    const [result] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), eq(assets.id, id)))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async getByCode(tenantId: string, customerId: string, code: string): Promise<Asset | null> {
    const [result] = await db
      .select()
      .from(assets)
      .where(and(
        eq(assets.tenantId, tenantId),
        eq(assets.customerId, customerId),
        eq(assets.code, code)
      ))
      .limit(1);

    return result ? this.mapToEntity(result) : null;
  }

  async update(tenantId: string, id: string, data: UpdateAssetDTO, updatedBy: string): Promise<Asset> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('ASSET_NOT_FOUND', 'Asset not found', 404);
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy,
      version: existing.version + 1,
    };

    // Only update fields that are provided
    if (data.name !== undefined) updateData.name = data.name;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.code !== undefined) updateData.code = data.code;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.location !== undefined) updateData.location = { ...existing.location, ...data.location };
    if (data.specs !== undefined) updateData.specs = { ...existing.specs, ...data.specs };
    if (data.tags !== undefined) updateData.tags = data.tags;
    if (data.metadata !== undefined) updateData.metadata = { ...existing.metadata, ...data.metadata };
    if (data.status !== undefined) updateData.status = data.status;

    const [result] = await db
      .update(assets)
      .set(updateData)
      .where(and(
        eq(assets.tenantId, tenantId),
        eq(assets.id, id),
        eq(assets.version, existing.version) // Optimistic locking
      ))
      .returning();

    if (!result) {
      throw new AppError('CONCURRENT_UPDATE', 'Asset was modified by another process', 409);
    }

    return this.mapToEntity(result);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    // Check for children first
    const children = await this.getChildren(tenantId, id);
    if (children.length > 0) {
      throw new AppError('HAS_CHILDREN', 'Cannot delete asset with children', 400);
    }

    await db
      .delete(assets)
      .where(and(eq(assets.tenantId, tenantId), eq(assets.id, id)));
  }

  async list(tenantId: string, params?: ListAssetsParams): Promise<PaginatedResult<Asset>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [eq(assets.tenantId, tenantId)];

    if (params?.type) {
      conditions.push(eq(assets.type, params.type as typeof assets.type.enumValues[number]));
    }

    if (params?.status) {
      conditions.push(eq(assets.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    const results = await db
      .select()
      .from(assets)
      .where(and(...conditions))
      .orderBy(assets.createdAt)
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

  async listByCustomer(tenantId: string, customerId: string, params?: ListAssetsParams): Promise<PaginatedResult<Asset>> {
    const limit = params?.limit || 20;
    const offset = params?.cursor ? parseInt(params.cursor, 10) : 0;

    // Build conditions
    const conditions = [
      eq(assets.tenantId, tenantId),
      eq(assets.customerId, customerId),
    ];

    if (params?.type) {
      conditions.push(eq(assets.type, params.type as typeof assets.type.enumValues[number]));
    }

    if (params?.status) {
      conditions.push(eq(assets.status, params.status as 'ACTIVE' | 'INACTIVE' | 'DELETED'));
    }

    const results = await db
      .select()
      .from(assets)
      .where(and(...conditions))
      .orderBy(assets.name)
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

  async getChildren(tenantId: string, parentAssetId: string | null, customerId?: string): Promise<Asset[]> {
    let results;

    if (parentAssetId === null && customerId) {
      // Get root assets for a customer
      results = await db
        .select()
        .from(assets)
        .where(and(
          eq(assets.tenantId, tenantId),
          eq(assets.customerId, customerId),
          isNull(assets.parentAssetId)
        ))
        .orderBy(assets.name);
    } else if (parentAssetId === null) {
      // Get all root assets
      results = await db
        .select()
        .from(assets)
        .where(and(
          eq(assets.tenantId, tenantId),
          isNull(assets.parentAssetId)
        ))
        .orderBy(assets.name);
    } else {
      results = await db
        .select()
        .from(assets)
        .where(and(
          eq(assets.tenantId, tenantId),
          eq(assets.parentAssetId, parentAssetId)
        ))
        .orderBy(assets.name);
    }

    return results.map(this.mapToEntity);
  }

  async getDescendants(tenantId: string, assetId: string, maxDepth?: number): Promise<Asset[]> {
    const asset = await this.getById(tenantId, assetId);
    if (!asset) {
      throw new AppError('ASSET_NOT_FOUND', 'Asset not found', 404);
    }

    // Query by path prefix using LIKE
    const pathPrefix = `${asset.path}/%`;

    let results = await db
      .select()
      .from(assets)
      .where(and(
        eq(assets.tenantId, tenantId),
        like(assets.path, pathPrefix)
      ))
      .orderBy(assets.depth, assets.name);

    // Filter by maxDepth if specified
    if (maxDepth !== undefined) {
      const maxAllowedDepth = asset.depth + maxDepth;
      results = results.filter((a) => a.depth <= maxAllowedDepth);
    }

    return results.map(this.mapToEntity);
  }

  async getAncestors(tenantId: string, assetId: string): Promise<Asset[]> {
    const asset = await this.getById(tenantId, assetId);
    if (!asset) {
      throw new AppError('ASSET_NOT_FOUND', 'Asset not found', 404);
    }

    // Parse path to get ancestor IDs
    const pathParts = asset.path.split('/').filter(Boolean);
    // Remove tenant, customer, and self from path
    const ancestorIds = pathParts.slice(2, -1);

    if (ancestorIds.length === 0) {
      return [];
    }

    // Fetch ancestors
    const results = await db
      .select()
      .from(assets)
      .where(and(
        eq(assets.tenantId, tenantId),
        sql`${assets.id} = ANY(${ancestorIds})`
      ))
      .orderBy(assets.depth);

    return results.map(this.mapToEntity);
  }

  async getTree(tenantId: string, customerId?: string, rootAssetId?: string): Promise<AssetTreeNode[]> {
    let assetList: Asset[];

    if (rootAssetId) {
      const root = await this.getById(tenantId, rootAssetId);
      if (!root) {
        throw new AppError('ASSET_NOT_FOUND', 'Root asset not found', 404);
      }
      const descendants = await this.getDescendants(tenantId, rootAssetId);
      assetList = [root, ...descendants];
    } else if (customerId) {
      const result = await this.listByCustomer(tenantId, customerId, { limit: 1000 });
      assetList = result.items;
    } else {
      const result = await this.list(tenantId, { limit: 1000 });
      assetList = result.items;
    }

    return this.buildTree(assetList, rootAssetId || null);
  }

  async move(
    tenantId: string,
    assetId: string,
    newParentId: string | null,
    newCustomerId: string | null,
    updatedBy: string
  ): Promise<Asset> {
    const asset = await this.getById(tenantId, assetId);
    if (!asset) {
      throw new AppError('ASSET_NOT_FOUND', 'Asset not found', 404);
    }

    const targetCustomerId = newCustomerId || asset.customerId;

    // Validate new parent
    let newPath: string;
    let newDepth: number;

    if (newParentId) {
      const newParent = await this.getById(tenantId, newParentId);
      if (!newParent) {
        throw new AppError('PARENT_NOT_FOUND', 'New parent asset not found', 404);
      }

      if (newParent.customerId !== targetCustomerId) {
        throw new AppError('INVALID_PARENT', 'Parent asset must belong to the same customer', 400);
      }

      // Check for circular reference
      if (newParent.path.startsWith(asset.path)) {
        throw new AppError('CIRCULAR_REFERENCE', 'Cannot move asset under its own descendant', 400);
      }

      newPath = `${newParent.path}/${assetId}`;
      newDepth = newParent.depth + 1;
    } else {
      newPath = `/${tenantId}/${targetCustomerId}/${assetId}`;
      newDepth = 0;
    }

    const oldPath = asset.path;

    // Update asset with new customer if changed
    if (newCustomerId && newCustomerId !== asset.customerId) {
      await db
        .update(assets)
        .set({
          customerId: newCustomerId,
          parentAssetId: newParentId,
          updatedAt: new Date(),
          updatedBy,
        })
        .where(and(eq(assets.tenantId, tenantId), eq(assets.id, assetId)));
    }

    // Update path and depth
    await this.updatePath(tenantId, assetId, newPath, newDepth);

    // Update all descendants' paths
    const descendants = await this.getDescendants(tenantId, assetId);
    for (const descendant of descendants) {
      const descendantNewPath = descendant.path.replace(oldPath, newPath);
      const depthDiff = newDepth - asset.depth;
      await this.updatePath(tenantId, descendant.id, descendantNewPath, descendant.depth + depthDiff);

      // Update customer if needed
      if (newCustomerId && newCustomerId !== asset.customerId) {
        await db
          .update(assets)
          .set({ customerId: newCustomerId })
          .where(and(eq(assets.tenantId, tenantId), eq(assets.id, descendant.id)));
      }
    }

    return (await this.getById(tenantId, assetId))!;
  }

  async updatePath(tenantId: string, assetId: string, newPath: string, newDepth: number): Promise<void> {
    await db
      .update(assets)
      .set({
        path: newPath,
        depth: newDepth,
        updatedAt: new Date(),
      })
      .where(and(eq(assets.tenantId, tenantId), eq(assets.id, assetId)));
  }

  async countByCustomer(tenantId: string, customerId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(assets)
      .where(and(
        eq(assets.tenantId, tenantId),
        eq(assets.customerId, customerId)
      ));

    return result[0]?.count || 0;
  }

  private buildTree(assetList: Asset[], rootParentId: string | null): AssetTreeNode[] {
    const assetMap = new Map<string, AssetTreeNode>();
    const roots: AssetTreeNode[] = [];

    // Initialize all nodes
    assetList.forEach((asset) => {
      assetMap.set(asset.id, { ...asset, children: [] });
    });

    // Build tree structure
    assetList.forEach((asset) => {
      const node = assetMap.get(asset.id)!;
      if (asset.parentAssetId === rootParentId) {
        roots.push(node);
      } else if (asset.parentAssetId && assetMap.has(asset.parentAssetId)) {
        assetMap.get(asset.parentAssetId)!.children.push(node);
      }
    });

    // Sort children by name
    const sortChildren = (nodes: AssetTreeNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach((node) => sortChildren(node.children));
    };
    sortChildren(roots);

    return roots;
  }

  private generateCode(name: string): string {
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 20);
  }

  private mapToEntity(row: typeof assets.$inferSelect): Asset {
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      parentAssetId: row.parentAssetId,
      path: row.path,
      depth: row.depth,
      name: row.name,
      displayName: row.displayName,
      code: row.code,
      type: row.type,
      description: row.description || undefined,
      location: row.location as Asset['location'],
      specs: row.specs as Asset['specs'],
      tags: row.tags as string[],
      metadata: row.metadata as Record<string, unknown>,
      status: row.status,
      deletedAt: row.deletedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      createdBy: row.createdBy || undefined,
      updatedBy: row.updatedBy || undefined,
      version: row.version,
    };
  }
}

// Export singleton instance
export const assetRepository = new AssetRepository();
