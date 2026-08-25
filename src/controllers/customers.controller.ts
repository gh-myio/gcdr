import { Router, Request, Response, NextFunction } from 'express';
import { customerService } from '../services/CustomerService';
import { customerConfigService } from '../services/CustomerConfigService';
import { assertCustomerConfigAccess } from '../middleware/requireCustomerConfigAccess';
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  MoveCustomerSchema,
  ListCustomersParams
} from '../dto/request/CustomerDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { CustomerType, EventType } from '../shared/types';

const router = Router();

const CUSTOMER_ID_REQUIRED = 'Customer ID is required';

/**
 * POST /customers
 * Create a new customer
 */
router.post('/',
  logEvent({
    eventType: EventType.CUSTOMER_CREATED,
    description: (req) => `Customer "${req.body.name}" created`,
    getEntityId: (_req, res) => res.locals.data?.id,
    getCustomerId: (_req, res) => res.locals.data?.id,
    getNewValue: (_req, res) => res.locals.data,
    getMetadata: (req) => ({ type: req.body.type, parentCustomerId: req.body.parentCustomerId }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const data = CreateCustomerSchema.parse(req.body);
      const customer = await customerService.create(tenantId, data, userId);
      res.locals.data = customer;
      sendCreated(res, customer, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /customers
 * List customers
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor, type, status, parentCustomerId, search } = req.query;

    const params: ListCustomersParams = {
      limit: limit ? parseInt(limit as string, 10) : 20,
      cursor: cursor as string | undefined,
      type: type as CustomerType | undefined,
      status: status as 'ACTIVE' | 'INACTIVE' | undefined,
      parentCustomerId: parentCustomerId === 'null' ? null : (parentCustomerId as string | undefined),
      search: search as string | undefined,
    };

    const result = await customerService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/exists?code=<value>
 *
 * Existence check for a customer code (unique per tenant_id, code). Lets the FE
 * validate a code before submitting a create/edit form. Mirrors
 * GET /devices/exists and GET /assets/exists.
 *
 * Query params: code (required, trimmed, max 50 chars)
 * Response: { exists: boolean, count: number }
 */
router.get('/exists', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const code = (req.query.code as string | undefined)?.trim();
    if (!code) {
      throw new ValidationError('Query param "code" is required');
    }
    if (code.length > 50) {
      throw new ValidationError('Query param "code" must be <= 50 chars');
    }
    const result = await customerService.codeExists(tenantId, code);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/external/:externalId
 *   ?deep=0|1                    (default 0) — include assets + devices
 *   &allRules=0|1                (default 0) — attach rule meta to each device
 *   &filterOnlyDevicesWithRules=0|1 (default 0) — exclude devices with no rules
 */
router.get('/external/:externalId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { externalId } = req.params;
    const deep                       = req.query.deep === '1';
    const allRules                   = req.query.allRules === '1';
    const filterOnlyDevicesWithRules = req.query.filterOnlyDevicesWithRules === '1';
    const includeInternalSupportRule = req.query.includeInternalSupportRule !== 'false';

    if (!externalId) {
      throw new ValidationError('External ID is required');
    }

    const result = await customerService.getEnrichedByExternalId(
      tenantId, externalId, deep, allRules, filterOnlyDevicesWithRules, includeInternalSupportRule,
    );

    sendSuccess(res, deep ? result : result.customer, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:id
 * Get customer by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError(CUSTOMER_ID_REQUIRED);
    }

    const customer = await customerService.getById(tenantId, id);

    // RFC-0057 DEC-11: opt-in inline consolidated config under a NEW field
    // `configResolved` (masked secrets). The existing raw `config` field is left
    // untouched for back-compat. Same authorization as GET /customers/:id.
    const include = String(req.query.include ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (include.includes('config')) {
      // Same authorization as GET /customers/:id/config (P0.1): the general
      // /customers router only runs hybridAuthByMethod, so enforce the API-key
      // hierarchy + RBAC customer:<id> here before exposing configResolved.
      await assertCustomerConfigAccess(req, id, 'GET');
      const configResolved = await customerConfigService.getConfig(tenantId, id);
      sendSuccess(res, { ...customer, configResolved }, 200, requestId);
      return;
    }

    sendSuccess(res, customer, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /customers/:id
 * Update customer
 */
router.put('/:id',
  logEvent({
    eventType: EventType.CUSTOMER_UPDATED,
    description: (req) => `Customer ${req.params.id} updated`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req) => req.params.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
    getNewValue: (_req, res) => res.locals.data,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError(CUSTOMER_ID_REQUIRED);
      }

      // Get previous value for audit
      const previous = await customerService.getById(tenantId, id);
      res.locals.previousData = previous;

      const data = UpdateCustomerSchema.parse(req.body);
      const customer = await customerService.update(tenantId, id, data, userId);
      res.locals.data = customer;
      sendSuccess(res, customer, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /customers/:id
 * Delete customer
 */
router.delete('/:id',
  logEvent({
    eventType: EventType.CUSTOMER_DELETED,
    description: (req) => `Customer ${req.params.id} deleted`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req) => req.params.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError(CUSTOMER_ID_REQUIRED);
      }

      // Get previous value for audit
      const previous = await customerService.getById(tenantId, id);
      res.locals.previousData = previous;

      await customerService.delete(tenantId, id, userId);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /customers/:id/force
 * Force delete customer (and all descendants) with all associated data:
 * assets, devices, rules, centrals, groups, API keys, users, etc.
 */
router.delete('/:id/force',
  logEvent({
    eventType: EventType.CUSTOMER_FORCE_DELETED,
    description: (req) => `Customer ${req.params.id} force deleted with all associated data`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req) => req.params.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
    getMetadata: (_req, res) => res.locals.data,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError(CUSTOMER_ID_REQUIRED);
      }

      const previous = await customerService.getById(tenantId, id);
      res.locals.previousData = previous;

      const options = {
        keepApiKeys: req.query.keepApiKeys === 'true',
        keepCentrals: req.query.keepCentrals === 'true',
        keepRules: req.query.keepRules === 'true',
      };

      const result = await customerService.forceDelete(tenantId, id, userId, options);
      res.locals.data = result;
      sendSuccess(res, result, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /customers/:id/children
 * Get direct children of a customer
 */
router.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError(CUSTOMER_ID_REQUIRED);
    }

    const children = await customerService.getChildren(tenantId, id);
    sendSuccess(res, { items: children, count: children.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:id/descendants
 * Get all descendants of a customer
 */
router.get('/:id/descendants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;
    const { maxDepth } = req.query;

    if (!id) {
      throw new ValidationError(CUSTOMER_ID_REQUIRED);
    }

    const params = {
      maxDepth: maxDepth ? parseInt(maxDepth as string, 10) : undefined,
    };

    const descendants = await customerService.getDescendants(tenantId, id, params);
    sendSuccess(res, { items: descendants, count: descendants.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:id/ancestors
 * Get all ancestors of a customer (path from root to parent)
 */
router.get('/:id/ancestors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError(CUSTOMER_ID_REQUIRED);
    }

    const ancestors = await customerService.getAncestors(tenantId, id);
    sendSuccess(res, { items: ancestors, count: ancestors.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:id/tree
 *   ?deep=1   include assets + centrals + devices for the customer and every descendant
 *
 * Default (deep=0): returns just the customer hierarchy as { tree: CustomerTreeNode[] }.
 * With deep=1: returns { tree: EnrichedCustomer } where each node carries its
 *   own assets[], centrals[], devices[] and recursive children[].
 */
router.get('/:id/tree', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;
    const deep = req.query.deep === '1';

    if (!id) {
      throw new ValidationError(CUSTOMER_ID_REQUIRED);
    }

    const tree = deep
      ? await customerService.getEnrichedTree(tenantId, id)
      : await customerService.getTree(tenantId, id);

    sendSuccess(res, { tree }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /customers/:id/move
 * Move customer to new parent
 */
router.post('/:id/move',
  logEvent({
    eventType: EventType.CUSTOMER_MOVED,
    description: (req) => `Customer ${req.params.id} moved to parent ${req.body.newParentCustomerId || 'root'}`,
    getEntityId: (req) => req.params.id,
    getCustomerId: (req) => req.params.id,
    getPreviousValue: (_req, res) => res.locals.previousData,
    getNewValue: (_req, res) => res.locals.data,
    getMetadata: (req) => ({ newParentCustomerId: req.body.newParentCustomerId }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { id } = req.params;

      if (!id) {
        throw new ValidationError(CUSTOMER_ID_REQUIRED);
      }

      // Get previous value for audit
      const previous = await customerService.getById(tenantId, id);
      res.locals.previousData = previous;

      const data = MoveCustomerSchema.parse(req.body);
      const customer = await customerService.move(tenantId, id, data, userId);
      res.locals.data = customer;
      sendSuccess(res, customer, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
