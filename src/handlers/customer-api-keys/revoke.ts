import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerApiKeyService } from '../../services/CustomerApiKeyService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * DELETE /customers/{customerId}/api-keys/{keyId}
 * Revoke (permanently delete) an API key
 *
 * Warning: This action cannot be undone. The key will stop working immediately.
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

    // Verify the key belongs to the customer first
    const existing = await customerApiKeyService.getApiKey(ctx.tenantId, keyId);
    if (existing.customerId !== customerId) {
      throw new ValidationError('API key does not belong to this customer');
    }

    await customerApiKeyService.revokeApiKey(ctx.tenantId, keyId);

    return ok({
      message: 'API key revoked successfully',
      keyId,
    });
  } catch (err) {
    return handleError(err);
  }
};
