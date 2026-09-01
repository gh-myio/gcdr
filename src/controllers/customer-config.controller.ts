import { Router, Request, Response, NextFunction } from 'express';
import { customerConfigService, CustomerConfigActor } from '../services/CustomerConfigService';
import { customerConfigBackfillService } from '../services/CustomerConfigBackfillService';
import {
  CustomerConfigSchema,
  CustomerConfigPatchSchema,
  SecretsWriteSchema,
} from '../dto/request/CustomerConfigDTO';
import { sendSuccess } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { logAuditEvent } from '../middleware/audit';
import { EventType, ActorType } from '../shared/types/audit.types';

// =============================================================================
// RFC-0057 — Customer Config Document (controller)
//
// Two routers, both constructed with mergeParams so :customerId from the parent
// mount is visible here:
//
//   configRouter (mounted /customers/:customerId/config, hybridAuthByMethod):
//     GET     /                — masked read model (customers:read)
//     PUT     /                — full replace of writable sections (customers:write)
//     PATCH   /                — deep-merge (customers:write)
//     DELETE  /                — reset writable sections to defaults (customers:write)
//     POST    /backfill-from-tb — RFC-0231 §8: TB SERVER_SCOPE → GCDR one-shot
//                                  backfill (customers:write, same tier as PUT/PATCH/
//                                  DELETE — hybridAuthByMethod treats every non-GET/HEAD/
//                                  OPTIONS verb as write). NOT callable with a customer's
//                                  own (browser-exposed, read-only) API key in practice —
//                                  it needs the SAME write scope PUT/PATCH already require,
//                                  which that key intentionally never has. Idempotent but
//                                  NOT safe to auto-trigger from the widget: it makes GCDR
//                                  match whatever TB currently says, so calling it on every
//                                  page load would silently overwrite a deliberate direct-
//                                  GCDR edit back to the TB value. An operator/ops action,
//                                  not a widget auto-sync.
//
//   configSecretsRouter (mounted /customers/:customerId/config/secrets,
//   authMiddleware — JWT/master key only, customer API keys DENIED, DEC-7):
//     GET     /   — audited reveal of real secret values
//     PUT     /   — set/clear secrets (secretEnvelope at rest); "***" -> 400
//
// RFC-0057 DEC-8 (revised): requireCustomerConfigSecretsAccess gates these with
// verb-split, high-risk RBAC permissions on customer:<id> —
//   GET → customers.secret.reveal, PUT → customers.secret.manage — neither of
// which the read-only policy (*.*.read / *.*.list) can match. Granted via
// policy:customer-secrets (seed 04-policies.sql → role:customer-admin).
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(name: string, value: string): void {
  if (!value || !UUID_REGEX.test(value)) {
    throw new ValidationError(`Invalid ${name}: "${value ?? ''}"`);
  }
}

function actorOf(req: Request): CustomerConfigActor {
  return {
    userId: req.context?.apiKeyId ?? req.context?.userId ?? req.user?.sub,
    userEmail: req.user?.email,
    actorType: req.context?.apiKeyId
      ? ActorType.SERVICE_ACCOUNT
      : (req.user ? ActorType.USER : ActorType.SYSTEM),
    requestId: req.context?.requestId,
  };
}

// -----------------------------------------------------------------------------
// Config CRUD router
// -----------------------------------------------------------------------------

const configRouter = Router({ mergeParams: true });

configRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);

    const doc = await customerConfigService.getConfig(tenantId, customerId);
    sendSuccess(res, doc, 200, requestId);
  } catch (err) {
    next(err);
  }
});

configRouter.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);

    const dto = CustomerConfigSchema.parse(req.body ?? {});
    const doc = await customerConfigService.putConfig(tenantId, customerId, dto, actorOf(req));
    sendSuccess(res, doc, 200, requestId);
  } catch (err) {
    next(err);
  }
});

configRouter.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);

    const dto = CustomerConfigPatchSchema.parse(req.body ?? {});
    const doc = await customerConfigService.patchConfig(tenantId, customerId, dto, actorOf(req));
    sendSuccess(res, doc, 200, requestId);
  } catch (err) {
    next(err);
  }
});

configRouter.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);

    const doc = await customerConfigService.deleteConfig(tenantId, customerId, actorOf(req));
    sendSuccess(res, doc, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// RFC-0231 §8: one-shot TB SERVER_SCOPE → GCDR backfill, replacing the manual
// ed1149PatchCustomerConfig DevTools workflow used to validate every ED-1149
// dual-read subtask up to this point. Wraps the already-unit-tested
// CustomerConfigBackfillService.backfillCustomer(), which was previously wired
// to no route at all. dryRun defaults to true — an explicit ?dryRun=false is
// required to actually write, mirroring the one-off backfill script this
// endpoint replaces.
configRouter.post('/backfill-from-tb', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);

    const attrs = (req.body?.attrs ?? {}) as Record<string, unknown>;
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
      throw new ValidationError('Request body must be { attrs: {...} } — a plain object of TB SERVER_SCOPE attributes.');
    }
    const dryRun = req.query.dryRun !== 'false';
    const actor = actorOf(req);

    const result = await customerConfigBackfillService.backfillCustomer(tenantId, customerId, attrs, {
      dryRun,
      actorId: actor.userId,
    });

    // CustomerConfigBackfillService doesn't emit its own audit event (unlike
    // putConfig/patchConfig/deleteConfig, which emit CUSTOMER_CONFIG_UPDATED via
    // emitConfigUpdated) — close that gap here for a real (non-dry-run) apply,
    // using the same event type + full actor so this shows up in the audit trail
    // alongside manual PUT/PATCH writes.
    if (!dryRun && result.applied) {
      try {
        await logAuditEvent(tenantId, EventType.CUSTOMER_CONFIG_UPDATED, {
          entityType: 'customer.config',
          entityId: customerId,
          customerId,
          userId: actor.userId,
          userEmail: actor.userEmail,
          actorType: actor.actorType ?? ActorType.SYSTEM,
          description: `CUSTOMER_CONFIG_UPDATED (backfill-from-tb) ${customerId}`,
          metadata: { method: 'BACKFILL', diff: result.diff },
          requestId: actor.requestId,
        });
      } catch (auditErr) {
        // Audit failures must never break the write path (mirrors CustomerConfigService.emit()).
        // eslint-disable-next-line no-console
        console.error('[customer-config.controller] backfill audit emit failed:', (auditErr as Error)?.message);
      }
    }

    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Secrets router (JWT/master key only — mounted with authMiddleware in app.ts)
// -----------------------------------------------------------------------------

const configSecretsRouter = Router({ mergeParams: true });

configSecretsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);

    const secrets = await customerConfigService.getSecrets(tenantId, customerId, actorOf(req));
    sendSuccess(res, secrets, 200, requestId);
  } catch (err) {
    next(err);
  }
});

configSecretsRouter.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;
    requireUuid('customerId', customerId);

    const body = SecretsWriteSchema.parse(req.body ?? {});
    const doc = await customerConfigService.putSecrets(tenantId, customerId, body, actorOf(req));
    sendSuccess(res, doc, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export { configSecretsRouter };
export default configRouter;
