// =============================================================================
// RFC-0057 (feedback-pre-merge P0.1 / P0.2) — authorization guards for the
// customer config document endpoints.
//
// hybridAuthByMethod / authMiddleware only AUTHENTICATE (and, for API keys,
// gate the customers:read / customers:write scope). They do NOT enforce WHICH
// customer the caller may touch. These guards mirror requireGoalsAccess /
// requireTariffAccess (RFC-0046 / RFC-0054) to close that gap:
//
//   /config  (requireCustomerConfigAccess):
//     API key (scope already gated upstream):
//       TENANT  → any customer of the tenant
//       SELF    → only the key's own customer
//       SUBTREE → the key's customer or any descendant
//       Out of reach → 404 (do not leak which customer ids exist).
//     JWT user: RBAC engine, scope-aware, deny-wins, against `customer:<id>`:
//       GET/HEAD/OPTIONS       → customers.hierarchy.read
//       PUT/PATCH/POST/DELETE  → customers.hierarchy.update
//       No grant → 403 (session stays valid).
//
//   /config/secrets (requireCustomerConfigSecretsAccess), DEC-7/DEC-8:
//     Customer API keys are ALWAYS denied (authMiddleware already rejects them;
//     defense-in-depth here too). JWT operators need the named
//     `customers:secrets:read` permission (RBAC dotted form
//     `customers.secret.read`) for BOTH GET (reveal) and PUT (write).
//
//   Master key / DISABLE_AUTH carry the '*' role and bypass (operator path).
// =============================================================================
import { Request, Response, NextFunction } from 'express';
import { authorizationService } from '../services/AuthorizationService';
import { customerRepository } from '../repositories/CustomerRepository';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../shared/errors/AppError';

// RBAC permissions (dotted domain.function.action so `*.*.*` full-admin and
// `*.*.read` read-only policies match unchanged).
export const PERM_CUSTOMER_CONFIG_READ = 'customers.hierarchy.read';
export const PERM_CUSTOMER_CONFIG_WRITE = 'customers.hierarchy.update';
// DEC-8 `customers:secrets:read` — a single permission gates BOTH secrets verbs.
export const PERM_CUSTOMER_SECRETS = 'customers.secret.read';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Core hierarchy + RBAC check for the general /config resource. Throws an
 * AppError on denial; returns void when allowed. Exported so the inline
 * `?include=config` flow in customers.controller can reuse the exact same rule.
 */
export async function assertCustomerConfigAccess(
  req: Request,
  customerId: string,
  method: string,
): Promise<void> {
  const roles = req.user?.roles ?? [];
  if (roles.includes('*')) return; // master key / DISABLE_AUTH

  const { tenantId, userId } = req.context;

  if (!customerId || !UUID_REGEX.test(customerId)) {
    throw new ValidationError(`Invalid customerId: "${customerId ?? ''}"`);
  }

  // ── API key: hierarchy enforcement (scope was gated by hybridAuth) ──────────
  if (req.context.apiKeyId) {
    const access = req.context.apiKeyHierarchyAccess;
    if (access === 'TENANT') return;

    const keyCustomerId = req.context.customerId;
    if (keyCustomerId && customerId === keyCustomerId) return;

    if (access === 'SUBTREE' && keyCustomerId) {
      const descendants = await customerRepository.getDescendants(tenantId, keyCustomerId);
      if (descendants.some((d) => d.id === customerId)) return;
    }

    // Out of the key's reach: 404 on purpose — do not leak existence.
    throw new NotFoundError('Customer not found');
  }

  // ── JWT user: RBAC evaluation ───────────────────────────────────────────────
  if (!userId) {
    throw new UnauthorizedError('Autenticação necessária');
  }

  const permission = READ_METHODS.has(method) ? PERM_CUSTOMER_CONFIG_READ : PERM_CUSTOMER_CONFIG_WRITE;
  const result = await authorizationService.evaluatePermission(tenantId, {
    userId,
    permission,
    resourceScope: `customer:${customerId}`,
  });
  if (result.allowed) return;

  throw new ForbiddenError('Sem permissão para a configuração deste cliente');
}

export function requireCustomerConfigAccess() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await assertCustomerConfigAccess(req, req.params.customerId, req.method);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Core guard for the secrets sub-resource. Customer API keys are always denied;
 * JWT operators need `customers:secrets:read` on `customer:<id>` for GET and PUT.
 */
export async function assertCustomerConfigSecretsAccess(
  req: Request,
  customerId: string,
): Promise<void> {
  const roles = req.user?.roles ?? [];
  if (roles.includes('*')) return; // master key / DISABLE_AUTH

  if (!customerId || !UUID_REGEX.test(customerId)) {
    throw new ValidationError(`Invalid customerId: "${customerId ?? ''}"`);
  }

  // Secrets are never reachable with a customer API key (DEC-7). authMiddleware
  // already blocks them at the door; this is defense-in-depth.
  if (req.context.apiKeyId) {
    throw new ForbiddenError('API keys cannot access customer secrets');
  }

  const { tenantId, userId } = req.context;
  if (!userId) {
    throw new UnauthorizedError('Autenticação necessária');
  }

  const result = await authorizationService.evaluatePermission(tenantId, {
    userId,
    permission: PERM_CUSTOMER_SECRETS,
    resourceScope: `customer:${customerId}`,
  });
  if (result.allowed) return;

  throw new ForbiddenError('Sem permissão para os secrets deste cliente (customers:secrets:read)');
}

export function requireCustomerConfigSecretsAccess() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await assertCustomerConfigSecretsAccess(req, req.params.customerId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
