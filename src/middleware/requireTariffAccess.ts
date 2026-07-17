// =============================================================================
// RFC-0054 — authorization guard for /customers/:customerId/tariffs.
//
// Modeled 1:1 on requireGoalsAccess (RFC-0046 P0.1): hybridAuth authenticates
// and gates the tariffs:read/tariffs:write scope for API keys; this guard adds
// WHICH customer the caller may touch.
//
//   API key (scope already gated upstream):
//     TENANT  → any customer of the tenant
//     SELF    → only the key's own customer
//     SUBTREE → the key's customer or any descendant
//     Out of reach → 404 (do not leak which customer ids exist).
//
//   JWT user: RBAC engine, scope-aware, deny-wins:
//     GET/HEAD/OPTIONS → tariffs.tariff.read
//     PUT/PATCH/DELETE → tariffs.tariff.update
//     against resourceScope `customer:<id>`. full-admin (*.*.*) / read-only
//     (*.*.read) match unchanged; no grant → 403 (session stays valid).
//
//   Master key / DISABLE_AUTH carry '*' and bypass.
// =============================================================================
import { Request, Response, NextFunction } from 'express';
import { authorizationService } from '../services/AuthorizationService';
import { customerRepository } from '../repositories/CustomerRepository';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../shared/errors/AppError';

export const PERM_TARIFFS_READ = 'tariffs.tariff.read';
export const PERM_TARIFFS_WRITE = 'tariffs.tariff.update';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireTariffAccess() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const roles = req.user?.roles ?? [];
      if (roles.includes('*')) return next();

      const { tenantId, userId } = req.context;
      const { customerId } = req.params;

      if (!customerId || !UUID_REGEX.test(customerId)) {
        throw new ValidationError(`Invalid customerId: "${customerId ?? ''}"`);
      }

      if (req.context.apiKeyId) {
        const access = req.context.apiKeyHierarchyAccess;
        if (access === 'TENANT') return next();

        const keyCustomerId = req.context.customerId;
        if (keyCustomerId && customerId === keyCustomerId) return next();

        if (access === 'SUBTREE' && keyCustomerId) {
          const descendants = await customerRepository.getDescendants(tenantId, keyCustomerId);
          if (descendants.some((d) => d.id === customerId)) return next();
        }

        throw new NotFoundError('Customer not found');
      }

      if (!userId) {
        throw new UnauthorizedError('Autenticação necessária');
      }

      const permission = READ_METHODS.has(req.method) ? PERM_TARIFFS_READ : PERM_TARIFFS_WRITE;
      const result = await authorizationService.evaluatePermission(tenantId, {
        userId,
        permission,
        resourceScope: `customer:${customerId}`,
      });
      if (result.allowed) return next();

      throw new ForbiddenError('Sem permissão para tarifas deste cliente');
    } catch (err) {
      next(err);
    }
  };
}
