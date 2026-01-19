import { Asset } from '../../domain/entities/Asset';
import { CreateAssetDTO, UpdateAssetDTO, ListAssetsParams } from '../../dto/request/AssetDTO';
import { PaginatedResult } from '../../shared/types';

export interface AssetTreeNode extends Asset {
  children: AssetTreeNode[];
}

export interface IAssetRepository {
  // CRUD
  create(tenantId: string, data: CreateAssetDTO, createdBy: string): Promise<Asset>;
  getById(tenantId: string, id: string): Promise<Asset | null>;
  getByCode(tenantId: string, customerId: string, code: string): Promise<Asset | null>;
  update(tenantId: string, id: string, data: UpdateAssetDTO, updatedBy: string): Promise<Asset>;
  delete(tenantId: string, id: string): Promise<void>;

  // List
  list(tenantId: string, params?: ListAssetsParams): Promise<PaginatedResult<Asset>>;
  listByCustomer(tenantId: string, customerId: string, params?: ListAssetsParams): Promise<PaginatedResult<Asset>>;

  // Hierarchy
  getChildren(tenantId: string, parentAssetId: string | null, customerId?: string): Promise<Asset[]>;
  getDescendants(tenantId: string, assetId: string, maxDepth?: number): Promise<Asset[]>;
  getAncestors(tenantId: string, assetId: string): Promise<Asset[]>;
  getTree(tenantId: string, customerId?: string, rootAssetId?: string): Promise<AssetTreeNode[]>;

  // Move
  move(tenantId: string, assetId: string, newParentId: string | null, newCustomerId: string | null, updatedBy: string): Promise<Asset>;
  updatePath(tenantId: string, assetId: string, newPath: string, newDepth: number): Promise<void>;

  // Count
  countByCustomer(tenantId: string, customerId: string): Promise<number>;
}
