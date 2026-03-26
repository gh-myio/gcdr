import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../shared/errors/AppError';
import { decodeJWT, JWTUser } from './context';
import { customerApiKeyService } from '../services/CustomerApiKeyService';
import { ApiKeyScope } from '../domain/entities/CustomerApiKey';

// DISABLE_AUTH=true bypasses all auth checks (development/testing only — never use in production)
const AUTH_DISABLED = process.env.DISABLE_AUTH === 'true';

const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';
const MASTER_USER_ID = '00000000-0000-0000-0000-000000000002';

function bypassAuth(req: Request, next: NextFunction): void {
  req.context.tenantId = process.env.DEFAULT_TENANT_ID || '11111111-1111-1111-1111-111111111111';
  req.context.userId = DEV_USER_ID;
  req.user = { sub: DEV_USER_ID, email: 'dev@local', tenant_id: req.context.tenantId, type: 'SERVICE_ACCOUNT', roles: ['*'] };
  next();
}

/**
 * Checks if the request carries a valid master API key.
 * The master key (GCDR_MASTER_API_KEY env var) grants full tenant access.
 * Requires X-Tenant-Id header to identify the target tenant.
 * Returns true and populates req context/user if valid; returns false otherwise.
 */
function tryMasterApiKey(req: Request): boolean {
  const masterKey = process.env.GCDR_MASTER_API_KEY;
  if (!masterKey) return false;

  const providedKey = req.headers['x-api-key'] as string | undefined;
  if (!providedKey || providedKey !== masterKey) return false;

  const tenantId = (req.headers['x-tenant-id'] as string | undefined)
    || process.env.DEFAULT_TENANT_ID
    || '11111111-1111-1111-1111-111111111111';

  req.context.tenantId = tenantId;
  req.context.userId = MASTER_USER_ID;
  req.context.apiKeyHierarchyAccess = 'TENANT';
  req.user = {
    sub: MASTER_USER_ID,
    email: 'master-api-key@system',
    tenant_id: tenantId,
    type: 'SERVICE_ACCOUNT',
    roles: ['*'],
  };
  return true;
}

/**
 * Authentication middleware - requires valid JWT token or master API key
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (AUTH_DISABLED) return bypassAuth(req, next);

  // Master API key grants full access
  if (tryMasterApiKey(req)) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new UnauthorizedError('Token de acesso não fornecido'));
    return;
  }

  const token = authHeader.slice(7);
  const user = decodeJWT(token);

  if (!user) {
    next(new UnauthorizedError('Token de acesso inválido ou expirado'));
    return;
  }

  req.user = user;
  req.context.tenantId = user.tenant_id;
  req.context.userId = user.sub;

  next();
}

/**
 * Optional authentication - extracts user if token present, but doesn't fail if missing
 */
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const user = decodeJWT(token);

    if (user) {
      req.user = user;
      req.context.tenantId = user.tenant_id;
      req.context.userId = user.sub;
    }
  }

  next();
}

/**
 * Require specific roles
 */
export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Autenticação necessária'));
      return;
    }

    const hasRole = roles.some(role => req.user!.roles.includes(role));

    if (!hasRole) {
      next(new UnauthorizedError(`Acesso negado. Roles necessárias: ${roles.join(', ')}`));
      return;
    }

    next();
  };
}

/**
 * Hybrid authentication middleware - supports JWT Bearer token, customer API Key, or master API key
 *
 * Priority:
 * 1. Master API key (GCDR_MASTER_API_KEY env var) — full tenant access
 * 2. Bearer token (Authorization header)
 * 3. Customer API Key (X-API-Key header) - X-Tenant-Id is optional (auto-discovered from key)
 *
 * @param requiredScope - Optional scope required for customer API Key authentication (ignored for master key)
 */
export function hybridAuthMiddleware(requiredScope?: ApiKeyScope | ApiKeyScope[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (AUTH_DISABLED) return bypassAuth(req, next);

    // Master API key — full access, no scope check needed
    if (tryMasterApiKey(req)) {
      next();
      return;
    }

    const authHeader = req.headers['authorization'];
    const apiKey = req.headers['x-api-key'] as string | undefined;

    // Try Bearer token first
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const user = decodeJWT(token);

      if (user) {
        req.user = user;
        req.context.tenantId = user.tenant_id;
        req.context.userId = user.sub;
        next();
        return;
      }
    }

    // Try API Key
    if (apiKey) {
      try {
        const clientIp = req.ip || req.socket.remoteAddress || '';
        const tenantIdHeader = req.headers['x-tenant-id'] as string | undefined;

        // If tenant provided, use faster tenant-specific lookup
        // Otherwise, auto-discover tenant from the API key
        const apiKeyContext = tenantIdHeader
          ? await customerApiKeyService.validateApiKeyWithTenant(
              tenantIdHeader,
              apiKey,
              clientIp,
              requiredScope
            )
          : await customerApiKeyService.validateApiKey(
              apiKey,
              clientIp,
              requiredScope
            );

        // Set context from API Key
        req.context.tenantId = apiKeyContext.tenantId;
        req.context.userId = apiKeyContext.keyId;
        req.context.apiKeyId = apiKeyContext.keyId;
        req.context.apiKeyScopes = apiKeyContext.scopes;
        req.context.apiKeyHierarchyAccess = apiKeyContext.hierarchyAccess;
        // TENANT keys have no customer restriction
        if (apiKeyContext.hierarchyAccess !== 'TENANT') {
          req.context.customerId = apiKeyContext.customerId;
        }

        // Create a minimal user object for API Key auth
        req.user = {
          sub: `apikey:${apiKeyContext.keyId}`,
          email: `apikey:${apiKeyContext.name}@system`,
          tenant_id: apiKeyContext.tenantId,
          type: 'SERVICE_ACCOUNT',
          roles: apiKeyContext.scopes.map(s => `scope:${s}`),
        };

        next();
        return;
      } catch (error) {
        // If API key validation fails, pass the error
        next(error);
        return;
      }
    }

    // No valid authentication found
    next(new UnauthorizedError('Token de acesso ou API Key não fornecido'));
  };
}

/**
 * Middleware that applies different scopes based on HTTP method.
 * GET/HEAD/OPTIONS → readScope
 * POST/PUT/PATCH/DELETE → writeScope
 */
export function hybridAuthByMethod(readScope: ApiKeyScope | ApiKeyScope[], writeScope: ApiKeyScope | ApiKeyScope[]) {
  const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req: Request, res: Response, next: NextFunction) => {
    const scope = READ_METHODS.has(req.method) ? readScope : writeScope;
    return hybridAuthMiddleware(scope)(req, res, next);
  };
}
