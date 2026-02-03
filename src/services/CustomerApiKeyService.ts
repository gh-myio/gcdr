import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  CustomerApiKey,
  CreateApiKeyResult,
  ApiKeyContext,
  ApiKeyScope,
  hasScope,
  formatKeyPrefix,
} from '../domain/entities/CustomerApiKey';
import { CustomerApiKeyRepository } from '../repositories/CustomerApiKeyRepository';
import { CustomerRepository } from '../repositories/CustomerRepository';
import { ICustomerApiKeyRepository } from '../repositories/interfaces/ICustomerApiKeyRepository';
import { ICustomerRepository } from '../repositories/interfaces/ICustomerRepository';
import { CreateCustomerApiKeyDTO, UpdateCustomerApiKeyDTO } from '../dto/request/CustomerApiKeyDTO';
import { NotFoundError, UnauthorizedError } from '../shared/errors/AppError';
import { PaginatedResult, PaginationParams } from '../shared/types';

// Key format: gcdr_cust_<32 random chars>
const KEY_PREFIX = 'gcdr_cust_';
const KEY_RANDOM_LENGTH = 32;

export class CustomerApiKeyService {
  private apiKeyRepository: ICustomerApiKeyRepository;
  private customerRepository: ICustomerRepository;

  constructor(
    apiKeyRepo?: ICustomerApiKeyRepository,
    customerRepo?: ICustomerRepository
  ) {
    this.apiKeyRepository = apiKeyRepo || new CustomerApiKeyRepository();
    this.customerRepository = customerRepo || new CustomerRepository();
  }

  /**
   * Create a new API key for a customer
   * Returns the plaintext key ONLY ONCE - it cannot be retrieved later
   */
  async createApiKey(
    tenantId: string,
    customerId: string,
    data: CreateCustomerApiKeyDTO,
    createdBy: string
  ): Promise<CreateApiKeyResult> {
    // Validate customer exists
    const customer = await this.customerRepository.getById(tenantId, customerId);
    if (!customer) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }

    // Generate secure random key
    const randomPart = crypto.randomBytes(KEY_RANDOM_LENGTH).toString('hex');
    const plaintextKey = `${KEY_PREFIX}${randomPart}`;

    // Hash the key for storage
    const keyHash = this.hashKey(plaintextKey);
    const keyPrefix = randomPart.substring(0, 8);

    const now = new Date().toISOString();
    const id = uuidv4();

    const apiKey: CustomerApiKey = {
      id,
      tenantId,
      customerId,
      keyHash,
      keyPrefix,
      name: data.name,
      description: data.description,
      scopes: data.scopes as ApiKeyScope[],
      expiresAt: data.expiresAt || null,
      isActive: true,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
      createdBy,
      version: 1,
    };

    await this.apiKeyRepository.create(apiKey);

    return {
      apiKey,
      plaintextKey,
    };
  }

  /**
   * Validate an API key and return its context (auto-discovers tenant from key)
   * Also updates usage statistics
   */
  async validateApiKey(
    plaintextKey: string,
    clientIp: string,
    requiredScope?: ApiKeyScope
  ): Promise<ApiKeyContext> {
    // Check key format
    if (!plaintextKey.startsWith(KEY_PREFIX)) {
      throw new UnauthorizedError('Invalid API key format');
    }

    // Hash and lookup without tenant (global search)
    const keyHash = this.hashKey(plaintextKey);
    const apiKey = await this.apiKeyRepository.getByKeyHashOnly(keyHash);

    if (!apiKey) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Check if active
    if (!apiKey.isActive) {
      throw new UnauthorizedError('API key is deactivated');
    }

    // Check expiration
    if (apiKey.expiresAt) {
      const expiresAt = new Date(apiKey.expiresAt);
      if (expiresAt < new Date()) {
        throw new UnauthorizedError('API key has expired');
      }
    }

    // Check scope
    if (requiredScope && !hasScope(apiKey.scopes, requiredScope)) {
      throw new UnauthorizedError(`API key does not have required scope: ${requiredScope}`);
    }

    // Update usage statistics (fire and forget - don't block the request)
    this.apiKeyRepository.updateLastUsed(apiKey.tenantId, apiKey.id, clientIp).catch(() => {});
    this.apiKeyRepository.incrementUsageCount(apiKey.tenantId, apiKey.id).catch(() => {});

    return {
      keyId: apiKey.id,
      tenantId: apiKey.tenantId,
      customerId: apiKey.customerId,
      scopes: apiKey.scopes,
      name: apiKey.name,
    };
  }

  /**
   * Validate an API key with known tenant
   */
  async validateApiKeyWithTenant(
    tenantId: string,
    plaintextKey: string,
    clientIp: string,
    requiredScope?: ApiKeyScope
  ): Promise<ApiKeyContext> {
    // Check key format
    if (!plaintextKey.startsWith(KEY_PREFIX)) {
      throw new UnauthorizedError('Invalid API key format');
    }

    // Hash and lookup
    const keyHash = this.hashKey(plaintextKey);
    const apiKey = await this.apiKeyRepository.getByKeyHash(tenantId, keyHash);

    if (!apiKey) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Check if active
    if (!apiKey.isActive) {
      throw new UnauthorizedError('API key is deactivated');
    }

    // Check expiration
    if (apiKey.expiresAt) {
      const expiresAt = new Date(apiKey.expiresAt);
      if (expiresAt < new Date()) {
        throw new UnauthorizedError('API key has expired');
      }
    }

    // Check scope
    if (requiredScope && !hasScope(apiKey.scopes, requiredScope)) {
      throw new UnauthorizedError(`API key does not have required scope: ${requiredScope}`);
    }

    // Update usage statistics (fire and forget - don't block the request)
    this.apiKeyRepository.updateLastUsed(tenantId, apiKey.id, clientIp).catch(() => {});
    this.apiKeyRepository.incrementUsageCount(tenantId, apiKey.id).catch(() => {});

    return {
      keyId: apiKey.id,
      tenantId: apiKey.tenantId,
      customerId: apiKey.customerId,
      scopes: apiKey.scopes,
      name: apiKey.name,
    };
  }

  /**
   * Get API key by ID
   */
  async getApiKey(tenantId: string, id: string): Promise<CustomerApiKey> {
    const apiKey = await this.apiKeyRepository.getById(tenantId, id);
    if (!apiKey) {
      throw new NotFoundError(`API key ${id} not found`);
    }
    return apiKey;
  }

  /**
   * List API keys for a customer
   */
  async listApiKeys(
    tenantId: string,
    customerId: string,
    options?: PaginationParams & { isActive?: boolean }
  ): Promise<PaginatedResult<CustomerApiKey>> {
    return this.apiKeyRepository.listByCustomer(tenantId, customerId, options);
  }

  /**
   * Update an API key
   */
  async updateApiKey(
    tenantId: string,
    id: string,
    data: UpdateCustomerApiKeyDTO,
    updatedBy: string
  ): Promise<CustomerApiKey> {
    const existing = await this.apiKeyRepository.getById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(`API key ${id} not found`);
    }

    const updated: CustomerApiKey = {
      ...existing,
      name: data.name ?? existing.name,
      description: data.description ?? existing.description,
      scopes: (data.scopes as ApiKeyScope[]) ?? existing.scopes,
      isActive: data.isActive ?? existing.isActive,
      updatedBy,
    };

    return this.apiKeyRepository.update(updated);
  }

  /**
   * Revoke (delete) an API key
   */
  async revokeApiKey(tenantId: string, id: string): Promise<void> {
    const existing = await this.apiKeyRepository.getById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(`API key ${id} not found`);
    }

    await this.apiKeyRepository.delete(tenantId, id);
  }

  /**
   * Deactivate an API key (soft delete)
   */
  async deactivateApiKey(tenantId: string, id: string, updatedBy: string): Promise<CustomerApiKey> {
    return this.updateApiKey(tenantId, id, { isActive: false }, updatedBy);
  }

  /**
   * Reactivate an API key
   */
  async reactivateApiKey(tenantId: string, id: string, updatedBy: string): Promise<CustomerApiKey> {
    return this.updateApiKey(tenantId, id, { isActive: true }, updatedBy);
  }

  /**
   * Hash an API key using SHA-256
   */
  private hashKey(plaintextKey: string): string {
    return crypto.createHash('sha256').update(plaintextKey).digest('hex');
  }
}

export const customerApiKeyService = new CustomerApiKeyService();
