import { APIGatewayProxyEvent } from 'aws-lambda';
import { UnauthorizedError } from '../../shared/errors/AppError';

export interface RequestContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ip: string;
}

export interface JWTUser {
  sub: string;
  tenant_id: string;
  email: string;
  roles: string[];
  type: string;
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

/**
 * Get tenant ID from request headers
 * @throws UnauthorizedError if tenant ID is not provided
 */
export function getTenantId(event: APIGatewayProxyEvent): string {
  const tenantId =
    event.headers['x-tenant-id'] ||
    event.headers['X-Tenant-Id'] ||
    event.headers['X-TENANT-ID'];

  if (!tenantId) {
    throw new UnauthorizedError('Header x-tenant-id é obrigatório');
  }

  return tenantId;
}

/**
 * Get client IP address from request
 */
export function getClientIp(event: APIGatewayProxyEvent): string {
  return (
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.requestContext.identity?.sourceIp ||
    'unknown'
  );
}

/**
 * Get current user from JWT token in Authorization header
 * Returns null if no valid token is present
 */
export function getCurrentUser(event: APIGatewayProxyEvent): JWTUser | null {
  const authHeader =
    event.headers['authorization'] || event.headers['Authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);

  try {
    // Decode JWT payload (without verification - verification should be done in AuthService)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    if (!payload) {
      return null;
    }

    // Base64url decode
    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = 4 - (base64.length % 4);
    if (padding !== 4) {
      base64 += '='.repeat(padding);
    }

    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      return null;
    }

    return {
      sub: decoded.sub,
      tenant_id: decoded.tenant_id,
      email: decoded.email,
      roles: decoded.roles || [],
      type: decoded.type,
    };
  } catch {
    return null;
  }
}

/**
 * Get current user from JWT token, throws if not authenticated
 * @throws UnauthorizedError if no valid token is present
 */
export function requireUser(event: APIGatewayProxyEvent): JWTUser {
  const user = getCurrentUser(event);
  if (!user) {
    throw new UnauthorizedError('Token de acesso inválido ou expirado');
  }
  return user;
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
