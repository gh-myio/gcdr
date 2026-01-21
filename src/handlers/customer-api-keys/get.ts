import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerApiKeyService } from '../../services/CustomerApiKeyService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * GET /customers/{customerId}/api-keys/{keyId}
 * Get details of a specific API key
 *
 * Note: The actual key value is never returned - only metadata
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;
    const keyId = event.pathParameters?.keyId;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }
    if (!keyId) {
      throw new ValidationError('API Key ID is required');
    }

    const apiKey = await customerApiKeyService.getApiKey(ctx.tenantId, keyId);

    // Verify the key belongs to the customer
    if (apiKey.customerId !== customerId) {
      throw new ValidationError('API key does not belong to this customer');
    }

    // Remove sensitive fields from response
    return ok({
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
    });
  } catch (err) {
    return handleError(err);
  }
};
