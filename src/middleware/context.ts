import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface RequestContext {
  tenantId: string;
  userId: string;
  requestId: string;
  ip: string;
  // API Key specific fields (optional)
  customerId?: string;
  apiKeyId?: string;
  apiKeyScopes?: string[];
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

const DEFAULT_TENANT_ID = 'tenant-default';
const DEFAULT_USER_ID = 'system';

/**
 * Middleware to extract and attach request context
 */
export function contextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tenantId = (req.headers['x-tenant-id'] as string) || DEFAULT_TENANT_ID;
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
