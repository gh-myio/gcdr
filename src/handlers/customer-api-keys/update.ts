import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerApiKeyService } from '../../services/CustomerApiKeyService';
import { UpdateCustomerApiKeySchema } from '../../dto/request/CustomerApiKeyDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * PUT /customers/{customerId}/api-keys/{keyId}
 * Update an API key's metadata
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

    const body = parseBody(event);
    const data = UpdateCustomerApiKeySchema.parse(body);

    // Verify the key belongs to the customer first
    const existing = await customerApiKeyService.getApiKey(ctx.tenantId, keyId);
    if (existing.customerId !== customerId) {
      throw new ValidationError('API key does not belong to this customer');
    }

    const updated = await customerApiKeyService.updateApiKey(
      ctx.tenantId,
      keyId,
      data,
      ctx.userId
    );

    // Remove sensitive fields from response
    return ok({
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
    });
  } catch (err) {
    return handleError(err);
  }
};
