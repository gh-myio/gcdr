// =============================================================================
// RFC-0046 — authorization guard for /customers/:customerId/goals (feedback P0.1).
//
// hybridAuth only authenticates: for API keys it checks the goals:read/goals:write
// scope, and for JWT it validates the token — neither enforces WHICH customer the
// caller may touch. This middleware closes both gaps:
//
//   API key (req.context.apiKeyId set — scope already gated upstream):
//     TENANT  → any customer of the tenant
//     SELF    → only the key's own customer
//     SUBTREE → the key's customer or any of its descendants
//     A customer outside the key's reach answers 404 (not 403) so a probing
//     key cannot enumerate which customer ids exist.
//
//   JWT user: evaluates the RBAC engine (assignments → roles → policies,
//     deny-wins, scope-aware — same path as requireSingleDashboardRead):
//       GET/HEAD/OPTIONS → goals.goal.read
//       PUT/PATCH/POST/DELETE → goals.goal.update
//     against resourceScope `customer:<id>`. `policy:full-admin` (*.*.*) and
//     `policy:read-only` (*.*.read) match without changes; a user with no
//     matching grant gets 403 (session is valid — 401 would log them out).
//
//   Master key / DISABLE_AUTH carry the '*' role and bypass (operator path).
// =============================================================================
import { Request, Response, NextFunction } from 'express';
import { authorizationService } from '../services/AuthorizationService';
import { customerRepository } from '../repositories/CustomerRepository';
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../shared/errors/AppError';

export const PERM_GOALS_READ = 'goals.goal.read';
export const PERM_GOALS_WRITE = 'goals.goal.update';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireGoalsAccess() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const roles = req.user?.roles ?? [];
      // Master key / DISABLE_AUTH: '*' role — full operator access.
      if (roles.includes('*')) return next();

      const { tenantId, userId } = req.context;
      const { customerId } = req.params;

      // Malformed ids answer 400 here; letting them through would surface as a
      // Postgres cast error (500) in the descendant/RBAC lookups below.
      if (!customerId || !UUID_REGEX.test(customerId)) {
        throw new ValidationError(`Invalid customerId: "${customerId ?? ''}"`);
      }

      // ── API key: hierarchy enforcement (scope was gated by hybridAuth) ──────
      if (req.context.apiKeyId) {
        const access = req.context.apiKeyHierarchyAccess;
        if (access === 'TENANT') return next();

        const keyCustomerId = req.context.customerId;
        if (keyCustomerId && customerId === keyCustomerId) return next();

        if (access === 'SUBTREE' && keyCustomerId) {
          const descendants = await customerRepository.getDescendants(tenantId, keyCustomerId);
          if (descendants.some((d) => d.id === customerId)) return next();
        }

        // Out of the key's reach: 404 on purpose — do not leak existence.
        throw new NotFoundError('Customer not found');
      }

      // ── JWT user: RBAC evaluation ────────────────────────────────────────────
      if (!userId) {
        throw new UnauthorizedError('Autenticação necessária');
      }

      const permission = READ_METHODS.has(req.method) ? PERM_GOALS_READ : PERM_GOALS_WRITE;
      const result = await authorizationService.evaluatePermission(tenantId, {
        userId,
        permission,
        resourceScope: `customer:${customerId}`,
      });
      if (result.allowed) return next();

      throw new ForbiddenError('Sem permissão para metas de consumo deste cliente');
    } catch (err) {
      next(err);
    }
  };
}
