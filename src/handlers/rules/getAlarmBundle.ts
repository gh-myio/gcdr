import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { alarmBundleService } from '../../services/AlarmBundleService';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { NotFoundError, ValidationError } from '../../shared/errors/AppError';

/**
 * GET /customers/{id}/alarm-rules/bundle
 *
 * Returns a complete alarm rules bundle for a customer, optimized for Node-RED consumption.
 *
 * Query parameters:
 * - domain: Filter by device domain (e.g., 'energy')
 * - deviceType: Filter by device type (e.g., 'STORE', 'ELEVATOR')
 * - includeDisabled: Include disabled rules (default: false)
 *
 * Headers:
 * - If-None-Match: ETag value for conditional requests (returns 304 if unchanged)
 *
 * Response headers:
 * - ETag: Bundle version hash for caching
 * - Cache-Control: Caching directives
 */
export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag, X-Bundle-Version, X-Bundle-Signature',
  };

  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
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
      tenantId: ctx.tenantId,
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
    return handleError(err);
  }
};
