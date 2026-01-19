import { APIGatewayProxyEvent } from 'aws-lambda';

export interface RequestContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ip: string;
}

// Default tenant for MVP - will be replaced with proper auth
const DEFAULT_TENANT_ID = 'tenant-default';
const DEFAULT_USER_ID = 'system';

export function extractContext(event: APIGatewayProxyEvent): RequestContext {
  // In MVP, we use headers for tenant/user identification
  // This will be replaced with JWT token validation
  const tenantId = event.headers['x-tenant-id'] || DEFAULT_TENANT_ID;
  const userId = event.headers['x-user-id'] || DEFAULT_USER_ID;
  const requestId = event.requestContext.requestId || 'unknown';
  const ip = event.requestContext.identity?.sourceIp || 'unknown';

  return {
    tenantId,
    userId,
    requestId,
    ip,
  };
}

export function parseBody<T>(event: APIGatewayProxyEvent): T {
  if (!event.body) {
    return {} as T;
  }

  try {
    return JSON.parse(event.body) as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

export function parseQueryParams(event: APIGatewayProxyEvent): Record<string, string | undefined> {
  return (event.queryStringParameters || {}) as Record<string, string | undefined>;
}

export function parsePathParams(event: APIGatewayProxyEvent): Record<string, string | undefined> {
  return (event.pathParameters || {}) as Record<string, string | undefined>;
}
