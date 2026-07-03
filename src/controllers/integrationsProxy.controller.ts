/**
 * RFC-0050 — Pre-Setup Integrations Proxy (phase B2).
 *
 * Mounted at /api/v1/integrations/{ingestion,thingsboard,central} BEFORE the
 * general /integrations (marketplace) router so Express's first-match routing
 * gives these specific prefixes priority.
 *
 * Gating (in order):
 * 1. Feature flag PRESETUP_PROXY_ENABLED — off means the routes answer 404,
 *    indistinguishable from not existing (deploy dark, flip when F5 starts).
 * 2. Role gate — requires role:presetup-operator or role:super-admin. Matches
 *    all three auth forms this codebase produces (see requirePresetupOperator):
 *    JWT role keys, master-key/service-account wildcard. Customer API keys
 *    (scope:* pseudo-roles) are deliberately NOT accepted: the proxy fronts
 *    tenant-global credentials, M2M keys have no business here.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { NotFoundError, ForbiddenError, UnauthorizedError } from '../shared/errors/AppError';
import { integrationsProxyService, ProxyTarget } from '../services/IntegrationsProxyService';

const ALLOWED_ROLES = ['*', 'role:super-admin', 'role:presetup-operator'];

export function isPresetupProxyEnabled(): boolean {
  return process.env.PRESETUP_PROXY_ENABLED === 'true';
}

/**
 * Role gate for the proxy. Exported for unit tests.
 *
 * Known codebase gotcha this must respect: `req.user.roles` carries RBAC role
 * KEYS for JWTs (`role:super-admin`), `['*']` for master key / service
 * accounts, and `scope:<s>` pseudo-roles for customer API keys. Scope
 * pseudo-roles are intentionally absent from ALLOWED_ROLES.
 */
export function requirePresetupOperator(req: Request, _res: Response, next: NextFunction): void {
  if (!isPresetupProxyEnabled()) {
    // Same wording as notFoundHandler so a dark route is indistinguishable
    // from a route that does not exist.
    next(new NotFoundError(`Route ${req.method} ${req.originalUrl.split('?')[0]} not found`));
    return;
  }
  if (!req.user) {
    next(new UnauthorizedError('Autenticação necessária'));
    return;
  }
  const roles = req.user.roles ?? [];
  if (!roles.some((r) => ALLOWED_ROLES.includes(r))) {
    next(new ForbiddenError('Acesso negado: requer role:presetup-operator'));
    return;
  }
  next();
}

function createProxyRouter(target: ProxyTarget): Router {
  const router = Router({ mergeParams: true });

  router.use(requirePresetupOperator);

  router.all('*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const queryIndex = req.url.indexOf('?');
      const query = queryIndex >= 0 ? req.url.slice(queryIndex + 1) : undefined;

      // express.json() has already parsed JSON bodies app-wide; re-serialize
      // for the relay. Non-JSON bodies are not used by the presetup targets.
      let body: string | undefined;
      if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'string') {
          body = req.body;
        } else if (Buffer.isBuffer(req.body)) {
          body = req.body.toString('utf8');
        } else if (Object.keys(req.body as Record<string, unknown>).length > 0) {
          body = JSON.stringify(req.body);
        }
      }

      const result = await integrationsProxyService.relay({
        target,
        method: req.method,
        path: req.path,
        query,
        contentType: body ? req.headers['content-type'] ?? 'application/json' : undefined,
        body,
        targetAuthorization: req.headers['x-target-authorization'] as string | undefined,
        requestId: req.context?.requestId,
        userId: req.context?.userId,
      });

      res.status(result.status);
      if (result.contentType) res.setHeader('Content-Type', result.contentType);
      res.send(result.body.length > 0 ? result.body : undefined);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const ingestionProxyController = createProxyRouter('ingestion');
export const thingsboardProxyController = createProxyRouter('thingsboard');
export const centralProxyController = createProxyRouter('central');
