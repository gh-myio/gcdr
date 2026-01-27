import { Router, Request, Response, NextFunction } from 'express';
import { customerApiKeyService } from '../services/CustomerApiKeyService';
import {
  CreateCustomerApiKeySchema,
  UpdateCustomerApiKeySchema,
  ListCustomerApiKeysQuerySchema
} from '../dto/request/CustomerApiKeyDTO';
import { sendSuccess, sendCreated } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

// This router is mounted at /customers/:customerId/api-keys
const router = Router({ mergeParams: true });

/**
 * POST /customers/:customerId/api-keys
 * Create a new API key for a customer
 *
 * IMPORTANT: The plaintext key is only returned once at creation.
 * Store it securely - it cannot be retrieved later!
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { customerId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const data = CreateCustomerApiKeySchema.parse(req.body);

    const result = await customerApiKeyService.createApiKey(
      tenantId,
      customerId,
      data,
      userId
    );

    sendCreated(res, {
      ...result.apiKey,
      key: result.plaintextKey,
      _warning: 'Store this key securely. It will not be shown again.',
    }, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:customerId/api-keys
 * List API keys for a customer
 *
 * Note: The actual key values are never returned - only metadata
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const query = ListCustomerApiKeysQuerySchema.parse(req.query);

    const result = await customerApiKeyService.listApiKeys(tenantId, customerId, {
      limit: query.limit,
      cursor: query.cursor,
      isActive: query.isActive,
    });

    // Remove sensitive fields from response
    const sanitizedItems = result.items.map(item => ({
      id: item.id,
      tenantId: item.tenantId,
      customerId: item.customerId,
      keyPrefix: item.keyPrefix,
      name: item.name,
      description: item.description,
      scopes: item.scopes,
      expiresAt: item.expiresAt,
      lastUsedAt: item.lastUsedAt,
      lastUsedIp: item.lastUsedIp,
      isActive: item.isActive,
      usageCount: item.usageCount,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
    }));

    sendSuccess(res, {
      items: sanitizedItems,
      pagination: result.pagination,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:customerId/api-keys/:keyId
 * Get details of a specific API key
 *
 * Note: The actual key value is never returned - only metadata
 */
router.get('/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId, keyId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }
    if (!keyId) {
      throw new ValidationError('API Key ID is required');
    }

    const apiKey = await customerApiKeyService.getApiKey(tenantId, keyId);

    // Verify the key belongs to the customer
    if (apiKey.customerId !== customerId) {
      throw new ValidationError('API key does not belong to this customer');
    }

    sendSuccess(res, {
      id: apiKey.id,
      tenantId: apiKey.tenantId,
      customerId: apiKey.customerId,
      keyPrefix: apiKey.keyPrefix,
      name: apiKey.name,
      description: apiKey.description,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
      lastUsedIp: apiKey.lastUsedIp,
      isActive: apiKey.isActive,
      usageCount: apiKey.usageCount,
      createdAt: apiKey.createdAt,
      createdBy: apiKey.createdBy,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /customers/:customerId/api-keys/:keyId
 * Update an API key's metadata
 */
router.put('/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { customerId, keyId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }
    if (!keyId) {
      throw new ValidationError('API Key ID is required');
    }

    const data = UpdateCustomerApiKeySchema.parse(req.body);

    // Verify the key belongs to the customer first
    const existing = await customerApiKeyService.getApiKey(tenantId, keyId);
    if (existing.customerId !== customerId) {
      throw new ValidationError('API key does not belong to this customer');
    }

    const updated = await customerApiKeyService.updateApiKey(tenantId, keyId, data, userId);

    sendSuccess(res, {
      id: updated.id,
      tenantId: updated.tenantId,
      customerId: updated.customerId,
      keyPrefix: updated.keyPrefix,
      name: updated.name,
      description: updated.description,
      scopes: updated.scopes,
      expiresAt: updated.expiresAt,
      isActive: updated.isActive,
      usageCount: updated.usageCount,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /customers/:customerId/api-keys/:keyId
 * Revoke (permanently delete) an API key
 *
 * Warning: This action cannot be undone. The key will stop working immediately.
 */
router.delete('/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId, keyId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }
    if (!keyId) {
      throw new ValidationError('API Key ID is required');
    }

    // Verify the key belongs to the customer first
    const existing = await customerApiKeyService.getApiKey(tenantId, keyId);
    if (existing.customerId !== customerId) {
      throw new ValidationError('API key does not belong to this customer');
    }

    await customerApiKeyService.revokeApiKey(tenantId, keyId);

    sendSuccess(res, {
      message: 'API key revoked successfully',
      keyId,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
