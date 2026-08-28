// =============================================================================
// RFC-0056 feedback (P0) — authorization guard for
// /customers/:customerId/integrations/:key/{sync-events,disable,reset}.
//
// hybridAuthMiddleware([customers:write, central-sync:write]) authenticates
// and scope-checks API keys, but never compares the key's own customer
// against :customerId in the URL — a SELF-scoped key bound to customer A
// could mutate customer B's integration state. Modeled 1:1 on
// requireCustomerConfigAccess (RFC-0057) / requireGoalsAccess (RFC-0046).
//
//   API key (scope already gated upstream):
//     TENANT  → any customer of the tenant
//     SELF    → only the key's own customer (the shape both the INITIAL
//               bootstrap key and an operator-issued full CENTRAL_API_KEY use)
//     SUBTREE → the key's customer or any descendant
//     Out of reach → 404 (do not leak which customer ids exist).
//
//   JWT user: RBAC engine, deny-wins — centrals.sync.write against
//     resourceScope `customer:<id>`. All three routes are mutations, so
//     there is no separate READ permission. No grant → 403 (session stays
//     valid — 401 would incorrectly log the user out).
//
//   Master key / DISABLE_AUTH carry '*' and bypass.
// =============================================================================
import { Request, Response, NextFunction } from 'express';
import { authorizationService } from '../services/AuthorizationService';
import { customerRepository } from '../repositories/CustomerRepository';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../shared/errors/AppError';

// RBAC permission (dotted domain.function.action — matches
// AuthorizationService's ^[a-z*]+\.[a-z*]+\.[a-z*]+$ format, and *.*.* /
// *.*.read policies).
export const PERM_CENTRAL_SYNC_WRITE = 'centrals.sync.write';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Core hierarchy + RBAC check. Throws an AppError on denial; returns void
 * when allowed.
 */
export async function assertCentralSyncAccess(req: Request, customerId: string): Promise<void> {
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

  // ── JWT user: RBAC evaluation ────────────────────────────────────────────────
  if (!userId) {
    throw new UnauthorizedError('Autenticação necessária');
  }

  const result = await authorizationService.evaluatePermission(tenantId, {
    userId,
    permission: PERM_CENTRAL_SYNC_WRITE,
    resourceScope: `customer:${customerId}`,
  });
  if (result.allowed) return;

  throw new ForbiddenError('Sem permissão para sincronizar integrações deste cliente');
}

export function requireCentralSyncAccess() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await assertCentralSyncAccess(req, req.params.customerId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
