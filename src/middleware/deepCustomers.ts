import { Request, Response, NextFunction } from 'express';
import { customerRepository } from '../repositories/CustomerRepository';

const AUTH_DISABLED = process.env.DISABLE_AUTH === 'true';

/**
 * Middleware: enforces API key hierarchy access and resolves customer tree.
 *
 * Hierarchy access levels (stored on the API key, ignored when DISABLE_AUTH=true):
 *   SELF    → key scoped to its own customer only; ?deep=1 is ignored
 *   SUBTREE → key can request ?deep=1 to include all descendants
 *   TENANT  → no customer restriction; customerId not set in context
 *
 * When DISABLE_AUTH=true (dev/test):
 *   - No restriction is enforced
 *   - ?deep=1 with a customerId query param resolves descendants normally
 *
 * Result sets req.context.allowedCustomerIds when multiple customers apply.
 * Controllers read:
 *   allowedCustomerIds  → inArray filter (deep subtree)
 *   customerId          → eq filter (single customer)
 *   neither             → tenant-wide (no customer filter)
 */
export async function resolveDeepCustomers(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { tenantId, customerId, apiKeyHierarchyAccess } = req.context;
    const deep = req.query['deep'] === '1' || req.query['deep'] === 'true';

    // DISABLE_AUTH=true: dev/test mode — no enforcement, resolve descendants if requested
    if (AUTH_DISABLED) {
      const targetId = customerId ?? req.query['customerId'] as string | undefined;
      if (deep && targetId) {
        const descendants = await customerRepository.getDescendants(tenantId, targetId);
        req.context.allowedCustomerIds = [targetId, ...descendants.map((d) => d.id)];
      }
      return next();
    }

    // No API key in context (JWT auth) — no customer restriction
    if (!apiKeyHierarchyAccess) {
      return next();
    }

    // TENANT key — no customer restriction regardless of ?deep
    if (apiKeyHierarchyAccess === 'TENANT') {
      return next();
    }

    // SELF key — always single customer, ?deep=1 is not allowed
    if (apiKeyHierarchyAccess === 'SELF') {
      // customerId is already set in context by auth middleware
      return next();
    }

    // SUBTREE key — resolve descendants when ?deep=1
    if (apiKeyHierarchyAccess === 'SUBTREE') {
      if (deep && customerId) {
        const descendants = await customerRepository.getDescendants(tenantId, customerId);
        req.context.allowedCustomerIds = [customerId, ...descendants.map((d) => d.id)];
      }
      // Without ?deep=1, behaves like SELF
      return next();
    }

    next();
  } catch (err) {
    next(err);
  }
}
