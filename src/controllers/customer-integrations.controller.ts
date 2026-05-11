import { Router, Request, Response, NextFunction } from 'express';
import { customerIntegrationService } from '../services/CustomerIntegrationService';
import {
  RecordSyncInputSchema,
  DisableInputSchema,
  ResetInputSchema,
  IntegrationKeyParamSchema,
  ReplaceCentralsItemsInputSchema,
  ItemUuidParamSchema,
  maskIntegrationsMapForRead,
  maskIntegrationStateForRead,
} from '../dto/request/CustomerIntegrationDTO';
import { sendSuccess } from '../middleware';
import { ValidationError, NotFoundError } from '../shared/errors/AppError';
import { ActorType } from '../shared/types/audit.types';

// =============================================================================
// RFC-0033 — Customer Integration Sync State (controller)
// =============================================================================
//
// Mounted at /customers/:customerId/integrations in app.ts. The router is
// constructed with mergeParams so :customerId from the parent route is
// available in req.params here.
//
// Routes:
//   GET    /                         — full integrations map
//   GET    /:key                     — one integration's state
//   POST   /:key/sync-events         — append a sync event (M2M ingress)
//   POST   /:key/disable             — admin-mark DISABLED
//   POST   /:key/reset               — admin-clear (back to IDLE)
//
// Auth is applied at mount time in app.ts (hybridAuthByMethod with
// customers:read on GET / customers:write on POST). Read paths apply
// mqttPassword masking before serialising; the audit-emission layer
// already strips credentials before they hit audit_logs.

const router = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actorContext(req: Request) {
  const apiKeyName = req.user?.email && req.user.email.startsWith('apikey:')
    ? req.user.email
    : undefined;
  const actorLabel = apiKeyName
    ?? req.user?.email
    ?? req.context?.userId
    ?? 'system';
  return {
    userId:    req.context?.apiKeyId ?? req.user?.sub,
    userEmail: req.user?.email,
    actorType: req.context?.apiKeyId ? ActorType.SERVICE_ACCOUNT : (req.user ? ActorType.USER : ActorType.SYSTEM),
    requestId: req.context?.requestId,
    actorLabel,
  };
}

function requireUuid(name: string, value: string): void {
  if (!UUID_REGEX.test(value)) throw new ValidationError(`Invalid ${name}: "${value}"`);
}

/**
 * GET /customers/:customerId/integrations
 * Full integrations map for one customer.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);

    const map = await customerIntegrationService.list(tenantId, customerId);
    sendSuccess(res, { integrations: maskIntegrationsMapForRead(map) }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:customerId/integrations/:key
 * One integration's state. Returns 404 when the key has never been
 * synchronised (= absent from the map).
 */
router.get('/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);
    const { key } = IntegrationKeyParamSchema.parse({ key: req.params.key });

    const state = await customerIntegrationService.get(tenantId, customerId, key);
    if (!state) {
      throw new NotFoundError(`Integration "${key}" never synchronised for customer ${customerId}`);
    }
    sendSuccess(res, maskIntegrationStateForRead(key, state), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /customers/:customerId/integrations/:key/sync-events
 * M2M ingress for sync events. Updates live state and emits one
 * CUSTOMER_INTEGRATION_SYNC audit row.
 */
router.post('/:key/sync-events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);
    const { key } = IntegrationKeyParamSchema.parse({ key: req.params.key });
    const input = RecordSyncInputSchema.parse(req.body ?? {});

    const next = await customerIntegrationService.recordSync(tenantId, customerId, key, input, actorContext(req));
    sendSuccess(res, maskIntegrationStateForRead(key, next), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /customers/:customerId/integrations/:key/disable
 * Mark an integration DISABLED. Admin-only by virtue of the
 * customers:write scope check at mount time.
 */
router.post('/:key/disable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);
    const { key } = IntegrationKeyParamSchema.parse({ key: req.params.key });
    const input = DisableInputSchema.parse(req.body ?? {});

    const ctx  = actorContext(req);
    const next = await customerIntegrationService.disable(tenantId, customerId, key, {
      ...ctx,
      actorLabel: input.actor,
      note: input.note,
    });
    sendSuccess(res, maskIntegrationStateForRead(key, next), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /customers/:customerId/integrations/:key/reset
 * Clear the integration state entirely.
 */
router.post('/:key/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);
    const { key } = IntegrationKeyParamSchema.parse({ key: req.params.key });
    const input = ResetInputSchema.parse(req.body ?? {});

    const ctx = actorContext(req);
    await customerIntegrationService.reset(tenantId, customerId, key, {
      ...ctx,
      actorLabel: input.actor,
    });
    sendSuccess(res, { ok: true, key }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /customers/:customerId/integrations/centrals/items
 * Admin replacement of the centrals.items[] array. Auth: `customers:write`
 * (already enforced at mount time via hybridAuthByMethod).
 *
 * Per-entry rule for mqttPassword: empty string on an existing uuid keeps
 * the previously-stored secret — admins editing a row don't have to retype
 * a password they can't read (passwords are masked on GET).
 */
router.put('/centrals/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);
    const input = ReplaceCentralsItemsInputSchema.parse(req.body ?? {});

    const ctx = actorContext(req);
    const next = await customerIntegrationService.replaceCentralsItems(
      tenantId,
      customerId,
      input,
      { ...ctx, actorLabel: input.actor },
    );
    sendSuccess(res, maskIntegrationStateForRead('centrals', next), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:customerId/integrations/centrals/items/:itemUuid/credentials
 * Reveal one central's plaintext MQTT password. Sensitive — every call
 * emits an audit log entry (CUSTOMER_INTEGRATION_CREDENTIALS_REVEALED).
 *
 * NOTE: `customers:write` is the current gate (admin-only). A dedicated
 * `centrals:credentials:read` scope would be cleaner; promoting this gate
 * is a future hardening once the RBAC layer surfaces credential scopes.
 *
 * Even though this is GET semantically (idempotent — returns the stored
 * password), it's mounted under the write-permission method because reveal
 * is the kind of action that warrants admin-level authorization, not just
 * read.
 */
router.post('/centrals/items/:itemUuid/reveal-credentials',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const { customerId } = req.params;
      requireUuid('customerId', customerId);
      const { itemUuid } = ItemUuidParamSchema.parse({ itemUuid: req.params.itemUuid });

      const ctx = actorContext(req);
      const result = await customerIntegrationService.revealCentralCredential(
        tenantId,
        customerId,
        itemUuid,
        { ...ctx, actorLabel: ctx.actorLabel },
      );
      sendSuccess(res, result, 200, requestId);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
