import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { alarmBundleService } from '../../services/AlarmBundleService';
import { handleError } from '../middleware/errorHandler';
import { extractContext, getTenantId } from '../middleware/requestContext';
import { hasApiKeyAuth, validateApiKeyAuth, extractTenantId } from '../middleware/apiKeyAuth';
import { NotFoundError, ValidationError, UnauthorizedError } from '../../shared/errors/AppError';

/**
 * GET /customers/{id}/alarm-rules/bundle
 *
 * Returns a complete alarm rules bundle for a customer, optimized for Node-RED consumption.
 *
 * Authentication (one of):
 * - API Key: X-API-Key header with a valid customer API key (recommended for M2M)
 * - JWT: Authorization Bearer token
 *
 * Required headers:
 * - x-tenant-id: Tenant identifier
 *
 * Query parameters:
 * - domain: Filter by device domain (e.g., 'energy')
 * - deviceType: Filter by device type (e.g., 'STORE', 'ELEVATOR')
 * - includeDisabled: Include disabled rules (default: false)
 *
 * Caching headers:
 * - If-None-Match: ETag value for conditional requests (returns 304 if unchanged)
 *
 * Response headers:
 * - ETag: Bundle version hash for caching
 * - Cache-Control: Caching directives
 * - X-Bundle-Version: Version identifier
 * - X-Bundle-Signature: HMAC signature for verification
 */
export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag, X-Bundle-Version, X-Bundle-Signature',
  };

  try {
    const customerId = event.pathParameters?.id;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    // Get tenant ID (required for both auth methods)
    const tenantId = extractTenantId(event);
    if (!tenantId) {
      throw new UnauthorizedError('Header x-tenant-id is required');
    }

    // Authenticate - prefer API Key for M2M, fall back to JWT context
    let authenticatedCustomerId: string | null = null;

    if (hasApiKeyAuth(event)) {
      // API Key authentication
      const apiKeyContext = await validateApiKeyAuth(event, 'bundles:read');

      // Verify the API key belongs to the requested customer
      if (apiKeyContext.customerId !== customerId) {
        throw new UnauthorizedError('API key does not have access to this customer');
      }

      authenticatedCustomerId = apiKeyContext.customerId;
    } else {
      // Fall back to JWT/header-based authentication (for backwards compatibility)
      const ctx = extractContext(event);
      // In MVP mode, we allow access based on tenant context
      // In production, you'd verify the user has access to the customer
      authenticatedCustomerId = customerId;
    }

    // Parse query parameters
    const queryParams = event.queryStringParameters || {};
    const domain = queryParams.domain;
    const deviceType = queryParams.deviceType;
    const includeDisabled = queryParams.includeDisabled === 'true';

    // Check for conditional request (If-None-Match header)
    const ifNoneMatch = event.headers['If-None-Match'] || event.headers['if-none-match'];

    // Generate the bundle
    const bundle = await alarmBundleService.generateBundle({
      tenantId,
      customerId,
      domain,
      deviceType,
      includeDisabled,
    });

    const etag = `"${bundle.meta.version}"`;

    // Return 304 Not Modified if ETag matches
    if (ifNoneMatch && ifNoneMatch === etag) {
      return {
        statusCode: 304,
        headers: {
          ...headers,
          'ETag': etag,
          'Cache-Control': `private, max-age=${bundle.meta.ttlSeconds}`,
        },
        body: '',
      };
    }

    // Return full bundle with caching headers
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'ETag': etag,
        'Cache-Control': `private, max-age=${bundle.meta.ttlSeconds}`,
        'X-Bundle-Version': bundle.meta.version,
        'X-Bundle-Signature': bundle.meta.signature,
      },
      body: JSON.stringify({
        success: true,
        data: bundle,
      }),
    };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: err.message,
          },
        }),
      };
    }
    if (err instanceof UnauthorizedError) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: err.message,
          },
        }),
      };
    }
    return handleError(err);
  }
};
