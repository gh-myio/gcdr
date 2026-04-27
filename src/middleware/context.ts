import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../shared/errors/AppError';

export interface RequestContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ip: string;
  // API Key specific fields (optional)
  customerId?: string;
  apiKeyId?: string;
  apiKeyScopes?: string[];
  apiKeyHierarchyAccess?: 'SELF' | 'SUBTREE' | 'TENANT';
  // Resolved when ?deep=1 with SUBTREE/TENANT key: customer + all descendants
  allowedCustomerIds?: string[];
}

export interface JWTUser {
  sub: string;
  tenant_id: string;
  email: string;
  roles: string[];
  type: string;
}

declare global {
  namespace Express {
    interface Request {
      context: RequestContext;
      user?: JWTUser;
    }
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Env-driven default tenant for unauthenticated requests (e.g. public endpoints
// hit directly from a browser without X-Tenant-Id). Must be a real UUID — the
// previous string literal `'tenant-default'` exploded with cast errors against
// any tenant_id::uuid column. Falls back to the seed tenant if env is unset.
const FALLBACK_TENANT_UUID = '11111111-1111-1111-1111-111111111111';
const ENV_DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID;
const DEFAULT_TENANT_ID =
  ENV_DEFAULT_TENANT && UUID_REGEX.test(ENV_DEFAULT_TENANT)
    ? ENV_DEFAULT_TENANT
    : FALLBACK_TENANT_UUID;

const DEFAULT_USER_ID = 'system';

/**
 * Middleware to extract and attach request context
 *
 * Tenant resolution rules:
 *   - X-Tenant-Id absent / empty → DEFAULT_TENANT_ID (real UUID)
 *   - X-Tenant-Id present and a valid UUID → used as-is
 *   - X-Tenant-Id present but not a UUID → 400 ValidationError (loud,
 *     prevents downstream PostgreSQL cast errors that surface as 500)
 */
export function contextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerTenant = req.headers['x-tenant-id'];
  let tenantId: string;
  if (headerTenant === undefined || headerTenant === '') {
    tenantId = DEFAULT_TENANT_ID;
  } else if (typeof headerTenant !== 'string' || !UUID_REGEX.test(headerTenant)) {
    next(new ValidationError(
      `X-Tenant-Id header must be a UUID (got '${String(headerTenant)}')`
    ));
    return;
  } else {
    tenantId = headerTenant;
  }

  const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER_ID;
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  const ip = getClientIp(req);

  req.context = {
    tenantId,
    userId,
    requestId,
    ip,
  };

  res.setHeader('X-Request-Id', requestId);

  next();
}

/**
 * Get client IP address from request
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Decode JWT token and extract user info
 */
export function decodeJWT(token: string): JWTUser | null {
  try {
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

    // Reject tokens where tenant_id is not a valid UUID (e.g. 'tenant-default')
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!decoded.tenant_id || !UUID_REGEX.test(decoded.tenant_id)) {
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
