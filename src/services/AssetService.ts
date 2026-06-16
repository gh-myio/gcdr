import { Asset } from '../domain/entities/Asset';
import {
  CreateAssetDTO,
  UpdateAssetDTO,
  MoveAssetDTO,
  ListAssetsParams,
  GetAssetDescendantsParams,
} from '../dto/request/AssetDTO';
import { AssetRepository } from '../repositories/AssetRepository';
import { AssetTreeNode, IAssetRepository } from '../repositories/interfaces/IAssetRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { ICustomerRepository } from '../repositories/interfaces/ICustomerRepository';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError } from '../shared/errors/AppError';
import { alarmBundleService } from './AlarmBundleService';

export class AssetService {
  private repository: IAssetRepository;
  private customerRepository: ICustomerRepository;

  constructor(repository?: IAssetRepository, customerRepository?: ICustomerRepository) {
    this.repository = repository || new AssetRepository();
    this.customerRepository = customerRepository || new CustomerRepository();
  }

  async create(tenantId: string, data: CreateAssetDTO, userId: string): Promise<Asset> {
    // Validate customer exists
    const customer = await this.customerRepository.getById(tenantId, data.customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${data.customerId} not found`);
    }

    // Validate parent asset if provided
    if (data.parentAssetId) {
      const parentAsset = await this.repository.getById(tenantId, data.parentAssetId);
      if (!parentAsset) {
        throw new NotFoundError(`Parent asset ${data.parentAssetId} not found`);
      }
      if (parentAsset.customerId !== data.customerId) {
        throw new ValidationError('Parent asset must belong to the same customer');
      }
    }

    // Upsert by code: if asset with same code already exists, update it
    if (data.code) {
      const existing = await this.repository.getByCode(tenantId, data.customerId, data.code);
      if (existing) {
        const updated = await this.repository.update(tenantId, existing.id, data, userId);
        alarmBundleService.invalidateCache(tenantId, data.customerId, {
          reason: 'asset_updated', entityType: 'asset', entityId: updated.id, userId,
        });
        return updated;
      }
    }

    const asset = await this.repository.create(tenantId, data, userId);

    alarmBundleService.invalidateCache(tenantId, data.customerId, {
      reason: 'asset_created', entityType: 'asset', entityId: asset.id, userId,
    });

    return asset;
  }

  async getById(tenantId: string, id: string): Promise<Asset> {
    const asset = await this.repository.getById(tenantId, id);
    if (!asset) {
      throw new NotFoundError(`Asset ${id} not found`);
    }
    return asset;
  }

  /**
   * Existence check for an asset code (unique per tenant_id, customer_id, code).
   * Lets the FE validate a code before submitting a create/edit form. Scoped to
   * one customer, mirroring the unique index. Code comparison is exact.
   */
  async codeExists(
    tenantId: string,
    customerId: string,
    code: string,
  ): Promise<{ exists: boolean; count: number }> {
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      return { exists: false, count: 0 };
    }
    const existing = await this.repository.getByCode(tenantId, customerId, trimmed);
    return { exists: Boolean(existing), count: existing ? 1 : 0 };
  }

  async update(tenantId: string, id: string, data: UpdateAssetDTO, userId: string): Promise<Asset> {
    const existing = await this.getById(tenantId, id);

    // Check for duplicate code if updating
    if (data.code && data.code !== existing.code) {
      const duplicateCode = await this.repository.getByCode(tenantId, existing.customerId, data.code);
      if (duplicateCode && duplicateCode.id !== id) {
        throw new ConflictError(`Asset with code ${data.code} already exists for this customer`);
      }
    }

    const asset = await this.repository.update(tenantId, id, data, userId);

    alarmBundleService.invalidateCache(tenantId, existing.customerId, {
      reason: 'asset_updated', entityType: 'asset', entityId: id, userId,
    });

    return asset;
  }

  async delete(tenantId: string, id: string, userId: string): Promise<void> {
    const asset = await this.getById(tenantId, id);

    // Check for children
    const children = await this.repository.getChildren(tenantId, id);
    if (children.length > 0) {
      throw new ValidationError('Cannot delete asset with children. Move or delete children first.');
    }

    // TODO: Check for devices attached to this asset

    await this.repository.delete(tenantId, id);

    alarmBundleService.invalidateCache(tenantId, asset.customerId, {
      reason: 'asset_deleted', entityType: 'asset', entityId: id, userId,
    });
  }

  async list(tenantId: string, params: ListAssetsParams): Promise<PaginatedResult<Asset>> {
    if (params.customerId) {
      // Validate customer exists
      const customer = await this.customerRepository.getById(tenantId, params.customerId);
      if (!customer) {
        throw new NotFoundError(`Customer ${params.customerId} not found`);
      }
      return this.repository.listByCustomer(tenantId, params.customerId, params);
    }
    return this.repository.list(tenantId, params);
  }

  async listByCustomer(tenantId: string, customerId: string, params?: ListAssetsParams): Promise<PaginatedResult<Asset>> {
    // Validate customer exists
    const customer = await this.customerRepository.getById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }
    return this.repository.listByCustomer(tenantId, customerId, params);
  }

  async getChildren(tenantId: string, assetId: string): Promise<Asset[]> {
    // Validate asset exists
    await this.getById(tenantId, assetId);
    return this.repository.getChildren(tenantId, assetId);
  }

  async getRootAssets(tenantId: string, customerId: string): Promise<Asset[]> {
    // Validate customer exists
    const customer = await this.customerRepository.getById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }
    return this.repository.getChildren(tenantId, null, customerId);
  }

  async getDescendants(
    tenantId: string,
    assetId: string,
    params?: GetAssetDescendantsParams
  ): Promise<Asset[]> {
    // Validate asset exists
    await this.getById(tenantId, assetId);
    return this.repository.getDescendants(tenantId, assetId, params?.maxDepth);
  }

  async getAncestors(tenantId: string, assetId: string): Promise<Asset[]> {
    return this.repository.getAncestors(tenantId, assetId);
  }

  async getTree(tenantId: string, customerId?: string, rootAssetId?: string): Promise<AssetTreeNode[]> {
    if (rootAssetId) {
      await this.getById(tenantId, rootAssetId);
    }
    if (customerId) {
      const customer = await this.customerRepository.getById(tenantId, customerId);
      if (!customer) {
        throw new NotFoundError(`Customer ${customerId} not found`);
      }
    }
    return this.repository.getTree(tenantId, customerId, rootAssetId);
  }

  async move(tenantId: string, assetId: string, data: MoveAssetDTO, userId: string): Promise<Asset> {
    const asset = await this.getById(tenantId, assetId);
    const targetCustomerId = data.newCustomerId || asset.customerId;

    // Validate new customer if changing
    if (data.newCustomerId && data.newCustomerId !== asset.customerId) {
      const newCustomer = await this.customerRepository.getById(tenantId, data.newCustomerId);
      if (!newCustomer) {
        throw new NotFoundError(`New customer ${data.newCustomerId} not found`);
      }
    }

    // Validate new parent if provided
    if (data.newParentAssetId) {
      const newParent = await this.repository.getById(tenantId, data.newParentAssetId);
      if (!newParent) {
        throw new NotFoundError(`New parent asset ${data.newParentAssetId} not found`);
      }

      if (newParent.customerId !== targetCustomerId) {
        throw new ValidationError('Parent asset must belong to the same customer');
      }

      // Check for circular reference
      if (data.newParentAssetId === assetId) {
        throw new ValidationError('Cannot move asset to itself');
      }

      const descendants = await this.repository.getDescendants(tenantId, assetId);
      const descendantIds = new Set(descendants.map((d) => d.id));
      if (descendantIds.has(data.newParentAssetId)) {
        throw new ValidationError('Cannot move asset under its own descendant');
      }
    }

    const movedAsset = await this.repository.move(
      tenantId,
      assetId,
      data.newParentAssetId,
      data.newCustomerId || null,
      userId
    );

    return movedAsset;
  }

  async countByCustomer(tenantId: string, customerId: string): Promise<number> {
    return this.repository.countByCustomer(tenantId, customerId);
  }
}

export const assetService = new AssetService();
