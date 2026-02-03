import { CustomerApiKey } from '../../domain/entities/CustomerApiKey';
import { PaginatedResult, PaginationParams } from '../../shared/types';

export interface ICustomerApiKeyRepository {
  /**
   * Create a new API key
   */
  create(apiKey: CustomerApiKey): Promise<CustomerApiKey>;

  /**
   * Get API key by ID
   */
  getById(tenantId: string, id: string): Promise<CustomerApiKey | null>;

  /**
   * Get API key by key hash (for validation)
   */
  getByKeyHash(tenantId: string, keyHash: string): Promise<CustomerApiKey | null>;

  /**
   * Get API key by key hash only (without tenant - for auto-discovery)
   * Used when X-Tenant-Id header is not provided
   */
  getByKeyHashOnly(keyHash: string): Promise<CustomerApiKey | null>;

  /**
   * List API keys for a customer
   */
  listByCustomer(
    tenantId: string,
    customerId: string,
    options?: PaginationParams & { isActive?: boolean }
  ): Promise<PaginatedResult<CustomerApiKey>>;

  /**
   * Update an API key
   */
  update(apiKey: CustomerApiKey): Promise<CustomerApiKey>;

  /**
   * Delete an API key
   */
  delete(tenantId: string, id: string): Promise<void>;

  /**
   * Update last used timestamp and IP
   */
  updateLastUsed(tenantId: string, id: string, ip: string): Promise<void>;

  /**
   * Increment usage count
   */
  incrementUsageCount(tenantId: string, id: string): Promise<void>;
}
