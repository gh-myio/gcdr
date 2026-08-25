import { Router, Request, Response, NextFunction } from 'express';
import { customerConfigService, CustomerConfigActor } from '../services/CustomerConfigService';
import {
  CustomerConfigSchema,
  CustomerConfigPatchSchema,
  SecretsWriteSchema,
} from '../dto/request/CustomerConfigDTO';
import { sendSuccess } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { ActorType } from '../shared/types/audit.types';

// =============================================================================
// RFC-0057 — Customer Config Document (controller)
//
// Two routers, both constructed with mergeParams so :customerId from the parent
// mount is visible here:
//
//   configRouter (mounted /customers/:customerId/config, hybridAuthByMethod):
//     GET     /   — masked read model (customers:read)
//     PUT     /   — full replace of writable sections (customers:write)
//     PATCH   /   — deep-merge (customers:write)
//     DELETE  /   — reset writable sections to defaults (customers:write)
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
