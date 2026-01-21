import { APIGatewayProxyEvent } from 'aws-lambda';
import { customerApiKeyService } from '../../services/CustomerApiKeyService';
import { ApiKeyContext, ApiKeyScope } from '../../domain/entities/CustomerApiKey';
import { UnauthorizedError } from '../../shared/errors/AppError';

/**
 * Extract API key from request headers
 */
export function extractApiKey(event: APIGatewayProxyEvent): string | null {
  // Check X-API-Key header (standard)
  const apiKey =
    event.headers['X-API-Key'] ||
    event.headers['x-api-key'] ||
    event.headers['X-Api-Key'];

  return apiKey || null;
}

/**
 * Extract tenant ID from headers
 */
export function extractTenantId(event: APIGatewayProxyEvent): string | null {
  return (
    event.headers['x-tenant-id'] ||
    event.headers['X-Tenant-Id'] ||
    event.headers['X-TENANT-ID'] ||
    null
  );
}

/**
 * Get client IP from request
 */
export function getClientIp(event: APIGatewayProxyEvent): string {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.requestContext.identity?.sourceIp ||
    'unknown'
  );
}

/**
 * Validate API key authentication for a request
 *
 * @param event - The API Gateway event
 * @param requiredScope - Optional scope required for the operation
 * @returns ApiKeyContext if valid
 * @throws UnauthorizedError if invalid or missing
 */
export async function validateApiKeyAuth(
  event: APIGatewayProxyEvent,
  requiredScope?: ApiKeyScope
): Promise<ApiKeyContext> {
  const apiKey = extractApiKey(event);

  if (!apiKey) {
    throw new UnauthorizedError('API key is required (X-API-Key header)');
  }

  const tenantId = extractTenantId(event);

  if (!tenantId) {
    throw new UnauthorizedError('Tenant ID is required (x-tenant-id header)');
  }

  const clientIp = getClientIp(event);

  return customerApiKeyService.validateApiKeyWithTenant(
    tenantId,
    apiKey,
    clientIp,
    requiredScope
  );
}

/**
 * Check if request has API key authentication
 */
export function hasApiKeyAuth(event: APIGatewayProxyEvent): boolean {
  return !!extractApiKey(event);
}

/**
 * Try to validate API key, returns null if no API key present
 * Useful for endpoints that support both API key and JWT auth
 */
export async function tryValidateApiKeyAuth(
  event: APIGatewayProxyEvent,
  requiredScope?: ApiKeyScope
): Promise<ApiKeyContext | null> {
  const apiKey = extractApiKey(event);

  if (!apiKey) {
    return null;
  }

  const tenantId = extractTenantId(event);

  if (!tenantId) {
    return null;
  }

  try {
    const clientIp = getClientIp(event);
    return await customerApiKeyService.validateApiKeyWithTenant(
      tenantId,
      apiKey,
      clientIp,
      requiredScope
    );
  } catch {
    return null;
  }
}
