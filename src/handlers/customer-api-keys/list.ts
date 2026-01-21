import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerApiKeyService } from '../../services/CustomerApiKeyService';
import { ListCustomerApiKeysQuerySchema } from '../../dto/request/CustomerApiKeyDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * GET /customers/{id}/api-keys
 * List API keys for a customer
 *
 * Note: The actual key values are never returned - only metadata
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const query = ListCustomerApiKeysQuerySchema.parse(event.queryStringParameters || {});

    const result = await customerApiKeyService.listApiKeys(ctx.tenantId, customerId, {
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

    return ok({
      items: sanitizedItems,
      pagination: result.pagination,
    });
  } catch (err) {
    return handleError(err);
  }
};
