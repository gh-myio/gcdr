import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Asset } from '../domain/entities/Asset';
import { CreateAssetDTO, UpdateAssetDTO, ListAssetsParams } from '../dto/request/AssetDTO';
import { PaginatedResult } from '../shared/types';
import { IAssetRepository, AssetTreeNode } from './interfaces/IAssetRepository';
import { dynamoDb, TableNames } from '../infrastructure/database/dynamoClient';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { AppError } from '../shared/errors/AppError';

export class AssetRepository implements IAssetRepository {
  private tableName = TableNames.ASSETS;

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

    const asset: Asset = {
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
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
    };

    await dynamoDb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: asset,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    return asset;
  }

  async getById(tenantId: string, id: string): Promise<Asset | null> {
    const result = await dynamoDb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
      })
    );

    return (result.Item as Asset) || null;
  }

  async getByCode(tenantId: string, customerId: string, code: string): Promise<Asset | null> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-customer-code',
        KeyConditionExpression: 'tenantId = :tenantId AND customerCode = :customerCode',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':customerCode': `${customerId}#${code}`,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return result.Items[0] as Asset;
  }

  async update(tenantId: string, id: string, data: UpdateAssetDTO, updatedBy: string): Promise<Asset> {
    const existing = await this.getById(tenantId, id);
    if (!existing) {
      throw new AppError('ASSET_NOT_FOUND', 'Asset not found', 404);
    }

    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    // Build dynamic update expression
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

    return result.Attributes as Asset;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    // Check for children first
    const children = await this.getChildren(tenantId, id);
    if (children.length > 0) {
      throw new AppError('HAS_CHILDREN', 'Cannot delete asset with children', 400);
    }

    await dynamoDb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, id },
        ConditionExpression: 'attribute_exists(id)',
      })
    );
  }

  async list(tenantId: string, params?: ListAssetsParams): Promise<PaginatedResult<Asset>> {
    const limit = params?.limit || 20;
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = { ':tenantId': tenantId };
    const expressionAttributeNames: Record<string, string> = {};

    // Add filters
    if (params?.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params?.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = params.status;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'tenantId = :tenantId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params?.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as Asset[]) || [];
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

  async listByCustomer(tenantId: string, customerId: string, params?: ListAssetsParams): Promise<PaginatedResult<Asset>> {
    const limit = params?.limit || 20;
    const filterExpressions: string[] = [];
    const expressionAttributeValues: Record<string, unknown> = {
      ':tenantId': tenantId,
      ':customerId': customerId,
    };
    const expressionAttributeNames: Record<string, string> = {};

    // Add filters
    if (params?.type) {
      filterExpressions.push('#type = :type');
      expressionAttributeNames['#type'] = 'type';
      expressionAttributeValues[':type'] = params.type;
    }

    if (params?.status) {
      filterExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = params.status;
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-customer',
        KeyConditionExpression: 'tenantId = :tenantId AND customerId = :customerId',
        FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
        Limit: limit + 1,
        ExclusiveStartKey: params?.cursor ? JSON.parse(Buffer.from(params.cursor, 'base64').toString()) : undefined,
      })
    );

    const items = (result.Items as Asset[]) || [];
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

  async getChildren(tenantId: string, parentAssetId: string | null, customerId?: string): Promise<Asset[]> {
    if (parentAssetId === null && customerId) {
      // Get root assets for a customer
      const result = await dynamoDb.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'gsi-customer',
          KeyConditionExpression: 'tenantId = :tenantId AND customerId = :customerId',
          FilterExpression: 'attribute_not_exists(parentAssetId) OR parentAssetId = :null',
          ExpressionAttributeValues: {
            ':tenantId': tenantId,
            ':customerId': customerId,
            ':null': null,
          },
        })
      );
      return (result.Items as Asset[]) || [];
    }

    if (parentAssetId === null) {
      // Get all root assets
      const result = await dynamoDb.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'tenantId = :tenantId',
          FilterExpression: 'attribute_not_exists(parentAssetId) OR parentAssetId = :null',
          ExpressionAttributeValues: {
            ':tenantId': tenantId,
            ':null': null,
          },
        })
      );
      return (result.Items as Asset[]) || [];
    }

    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-parent',
        KeyConditionExpression: 'tenantId = :tenantId AND parentAssetId = :parentId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':parentId': parentAssetId,
        },
      })
    );

    return (result.Items as Asset[]) || [];
  }

  async getDescendants(tenantId: string, assetId: string, maxDepth?: number): Promise<Asset[]> {
    const asset = await this.getById(tenantId, assetId);
    if (!asset) {
      throw new AppError('ASSET_NOT_FOUND', 'Asset not found', 404);
    }

    // Query by path prefix
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-path',
        KeyConditionExpression: 'tenantId = :tenantId AND begins_with(#path, :pathPrefix)',
        ExpressionAttributeNames: {
          '#path': 'path',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':pathPrefix': `${asset.path}/`,
        },
      })
    );

    let descendants = (result.Items as Asset[]) || [];

    // Filter by maxDepth if specified
    if (maxDepth !== undefined) {
      const maxAllowedDepth = asset.depth + maxDepth;
      descendants = descendants.filter((d) => d.depth <= maxAllowedDepth);
    }

    return descendants;
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

    // Batch get ancestors
    const keys = ancestorIds.map((id) => ({ tenantId, id }));
    const result = await dynamoDb.send(
      new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: keys,
          },
        },
      })
    );

    const ancestors = (result.Responses?.[this.tableName] as Asset[]) || [];

    // Sort by depth (root first)
    return ancestors.sort((a, b) => a.depth - b.depth);
  }

  async getTree(tenantId: string, customerId?: string, rootAssetId?: string): Promise<AssetTreeNode[]> {
    let assets: Asset[];

    if (rootAssetId) {
      const root = await this.getById(tenantId, rootAssetId);
      if (!root) {
        throw new AppError('ASSET_NOT_FOUND', 'Root asset not found', 404);
      }
      const descendants = await this.getDescendants(tenantId, rootAssetId);
      assets = [root, ...descendants];
    } else if (customerId) {
      const result = await this.listByCustomer(tenantId, customerId, { limit: 1000 });
      assets = result.items;
    } else {
      const result = await this.list(tenantId, { limit: 1000 });
      assets = result.items;
    }

    return this.buildTree(assets, rootAssetId || null);
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
      await dynamoDb.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { tenantId, id: assetId },
          UpdateExpression: 'SET customerId = :customerId, parentAssetId = :parentId, updatedAt = :updatedAt, updatedBy = :updatedBy',
          ExpressionAttributeValues: {
            ':customerId': newCustomerId,
            ':parentId': newParentId,
            ':updatedAt': now(),
            ':updatedBy': updatedBy,
          },
        })
      );
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
        await dynamoDb.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { tenantId, id: descendant.id },
            UpdateExpression: 'SET customerId = :customerId',
            ExpressionAttributeValues: {
              ':customerId': newCustomerId,
            },
          })
        );
      }
    }

    return (await this.getById(tenantId, assetId))!;
  }

  async updatePath(tenantId: string, assetId: string, newPath: string, newDepth: number): Promise<void> {
    await dynamoDb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, id: assetId },
        UpdateExpression: 'SET #path = :path, #depth = :depth, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#path': 'path',
          '#depth': 'depth',
        },
        ExpressionAttributeValues: {
          ':path': newPath,
          ':depth': newDepth,
          ':updatedAt': now(),
        },
      })
    );
  }

  async countByCustomer(tenantId: string, customerId: string): Promise<number> {
    const result = await dynamoDb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'gsi-customer',
        KeyConditionExpression: 'tenantId = :tenantId AND customerId = :customerId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':customerId': customerId,
        },
        Select: 'COUNT',
      })
    );

    return result.Count || 0;
  }

  private buildTree(assets: Asset[], rootParentId: string | null): AssetTreeNode[] {
    const assetMap = new Map<string, AssetTreeNode>();
    const roots: AssetTreeNode[] = [];

    // Initialize all nodes
    assets.forEach((asset) => {
      assetMap.set(asset.id, { ...asset, children: [] });
    });

    // Build tree structure
    assets.forEach((asset) => {
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
}
