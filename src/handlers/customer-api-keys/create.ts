import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerApiKeyService } from '../../services/CustomerApiKeyService';
import { CreateCustomerApiKeySchema } from '../../dto/request/CustomerApiKeyDTO';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * POST /customers/{id}/api-keys
 * Create a new API key for a customer
 *
 * IMPORTANT: The plaintext key is only returned once at creation.
 * Store it securely - it cannot be retrieved later!
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const body = parseBody(event);
    const data = CreateCustomerApiKeySchema.parse(body);

    const result = await customerApiKeyService.createApiKey(
      ctx.tenantId,
      customerId,
      data,
      ctx.userId
    );

    // Return the key with the plaintext (ONLY TIME IT'S VISIBLE)
    return created({
      ...result.apiKey,
      // Include the plaintext key in the response
      key: result.plaintextKey,
      // Warning to the user
      _warning: 'Store this key securely. It will not be shown again.',
    });
  } catch (err) {
    return handleError(err);
  }
};
