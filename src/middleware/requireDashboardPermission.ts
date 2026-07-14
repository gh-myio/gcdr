// =============================================================================
// RFC-0053 — real RBAC enforcement for the Single Dashboard route (JWT users).
//
// Until now every hybridAuth route was token-only for JWT (scope gates apply
// to API keys). This middleware closes that gap for the single-dashboard
// endpoint by evaluating the RBAC engine (AuthorizationService.evaluate:
// assignments → roles → policies, deny-wins, scope-aware).
//
// Scope semantics (docs/GCDR-USER.md §4):
//   assignment scope 'customer:<id>'             → whole-customer dashboards
//   assignment scope 'customer:<id>/asset:<id>'  → ONE asset's dashboard
//
// Resolution order:
//   1. Operator bypass: master key ('*' role) or API-key auth (already
//      scope-gated by hybridAuth).
//   2. Customer-level allow → full access (any assetId).
//   3. assetId present → hierarchical evaluate customer/asset.
//   4. No assetId + customer denied → auto-narrow to the user's single
//      asset-scoped grant (their dashboard IS that asset); 403 otherwise.
// =============================================================================
import { Request, Response, NextFunction } from 'express';
import { authorizationService } from '../services/AuthorizationService';

export const PERM_SINGLE_DASHBOARD_READ = 'dashboard.single.read';

const ASSET_IN_SCOPE = /(?:^|\/)asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function forbidden(res: Response, message: string): void {
  res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message },
  });
}

/** Asset ids granted to the user through asset-suffixed assignment scopes. */
async function allowedAssetIds(tenantId: string, userId: string, customerId: string): Promise<string[]> {
  const assignments = await authorizationService.getUserAssignments(tenantId, userId);
  const ids: string[] = [];
  for (const a of assignments) {
    const m = ASSET_IN_SCOPE.exec(a.scope);
    if (!m) continue;
    // 'asset:<id>' (bare) or 'customer:<this customer>/asset:<id>'
    if (a.scope.startsWith('customer:') && !a.scope.startsWith(`customer:${customerId}/`)) continue;
    ids.push(m[1]);
  }
  return [...new Set(ids)];
}

export function requireSingleDashboardRead() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const roles = req.user?.roles ?? [];
      // Master key ('*') and API keys pass: keys are scope-gated upstream.
      if (roles.includes('*') || req.context.apiKeyId) return next();

      const { tenantId, userId } = req.context;
      const { customerId } = req.params;
      if (!userId) return forbidden(res, 'Authenticated user required');

      const customerLevel = await authorizationService.evaluatePermission(tenantId, {
        userId,
        permission: PERM_SINGLE_DASHBOARD_READ,
        resourceScope: `customer:${customerId}`,
      });
      if (customerLevel.allowed) return next();

      const assetId = typeof req.query.assetId === 'string' ? req.query.assetId : undefined;
      if (assetId) {
        const assetLevel = await authorizationService.evaluatePermission(tenantId, {
          userId,
          permission: PERM_SINGLE_DASHBOARD_READ,
          resourceScope: `customer:${customerId}/asset:${assetId}`,
        });
        if (assetLevel.allowed) return next();
        return forbidden(res, 'Your access is limited to another asset');
      }

      // No assetId: narrow automatically when the user has exactly one grant.
      const assets = await allowedAssetIds(tenantId, userId, customerId);
      if (assets.length === 1) {
        req.query.assetId = assets[0];
        return next();
      }
      return forbidden(
        res,
        assets.length > 1
          ? 'Multiple asset grants — pass ?assetId= to pick one'
          : 'No single-dashboard access for this customer',
      );
    } catch (err) {
      next(err);
    }
  };
}
