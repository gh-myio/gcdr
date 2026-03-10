import { Request, Response, NextFunction } from 'express';
import { customerRepository } from '../repositories/CustomerRepository';

/**
 * Middleware: resolves customer hierarchy when ?deep=1 is present.
 *
 * - API key with customerId + deep=1  → resolves all descendants and sets
 *   req.context.allowedCustomerIds = [customerId, ...descendants]
 * - API key with customerId, no deep  → enforces single customer (SELF)
 * - JWT / no customerId in context    → no restriction (tenant-wide access)
 *
 * Controllers read req.context.allowedCustomerIds (multi) or
 * req.context.customerId (single) to build their WHERE clause.
 */
export async function resolveDeepCustomers(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { tenantId, customerId } = req.context;
    const deep = req.query['deep'] === '1' || req.query['deep'] === 'true';

    if (!customerId) {
      // JWT or tenant-level key — no customer restriction
      return next();
    }

    if (!deep) {
      // SELF: controller will use customerId as-is
      return next();
    }

    // SUBTREE: resolve descendants via path prefix (efficient, no recursion)
    const descendants = await customerRepository.getDescendants(tenantId, customerId);
    req.context.allowedCustomerIds = [customerId, ...descendants.map((d) => d.id)];

    next();
  } catch (err) {
    next(err);
  }
}
