import { Router, Request, Response, NextFunction } from 'express';
import { entityService } from '../services/EntityService';
import {
  CreateEntitySchema,
  UpdateEntitySchema,
  ListEntitiesQuerySchema,
  CloneSchema,
  RevertSchema,
  BulkReplaceSchema,
  BulkReplaceQuerySchema,
  CreateEntityTypeSchema,
  UpdateEntityTypeSchema,
} from '../dto/request/EntityDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';

/** Coerce the `deep` query param (`string | string[]`) to `number | 'all' | undefined`. */
function parseDeep(v: unknown): number | 'all' | undefined {
  if (v === undefined || v === '') return undefined;
  if (v === 'all') return 'all';
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce the `state` query param to the entity state enum (else undefined). */
function parseState(v: unknown): 'active' | 'inactive' | 'all' | undefined {
  return v === 'active' || v === 'inactive' || v === 'all' ? v : undefined;
}

const ERR_ID_REQUIRED = 'Entity ID is required';
const ERR_TYPE_REQUIRED = 'Entity type is required';

const router = Router();

// `/entity-types` is a TOP-LEVEL sibling of `/entities` per RFC-0047-Entity-API
// §2 (mounted at /api/v1/entity-types), so it gets its own router rather than
// living under the `/entities` mount.
const entityTypesRouter = Router();

// =============================================================================
// RFC-0047 — Generic Entity Registry · Express router
// =============================================================================
// Wire contract: docs/rfcs/RFC-0047-Entity-API.md §2. Mounted in app.ts under
// `/entities` with `hybridAuthByMethod('entities:read','entities:write')` — so
// reads are gated by entities:read (or *:read) and writes by entities:write
// (MYIO-operator only; a customer key gcdr_cust_* is read/resolve-only and a
// write attempt yields 403 at the mount). The `isAdmin` tier below is the EXTRA
// gate for `entity_type` creation + `is_system` row mutation.

/**
 * Compute the admin tier from the request context. `isAdmin` is true when the
 * caller is a platform admin — the tier that may create an `entity_type` or
 * mutate an `is_system` row. The route mount already gates write access; this is
 * the EXTRA gate. Three caller shapes carry an admin grant, and they spell it
 * differently:
 *  - API keys: an `entities:admin` or `*:*` scope on `req.context.apiKeyScopes`
 *    (and the auth layer also mirrors these onto a key-derived user's roles as
 *    `scope:<scope>`).
 *  - Real JWT login: `req.user.roles` holds RBAC role KEYS (from
 *    `getUserRoleKeys`), so the platform super-admin is `role:super-admin`
 *    (policy:full-admin) — the JWT equivalent of the `entities:admin` tier.
 *    A `role:customer-admin` is NOT a platform admin and must not mutate the
 *    global is_system defaults, so we match super-admin specifically.
 *  - Dev / service-account / master-key bypass: a bare `*` full-access wildcard.
 */
function isAdminContext(req: Request): boolean {
  // Scope-shaped admin grants (API keys, and `scope:<scope>` on key-derived JWTs).
  const ADMIN_SCOPES = new Set(['entities:admin', '*:*']);
  // Role-shaped admin grants on a real JWT login (RBAC role keys) + dev wildcard.
  const ADMIN_ROLES = new Set(['*', 'role:super-admin']);

  const apiKeyScopes = req.context?.apiKeyScopes ?? [];
  if (apiKeyScopes.some((s) => ADMIN_SCOPES.has(s))) {
    return true;
  }

  const roles = req.user?.roles ?? [];
  for (const role of roles) {
    if (ADMIN_ROLES.has(role) || ADMIN_SCOPES.has(role)) return true;
    if (role.startsWith('scope:') && ADMIN_SCOPES.has(role.slice('scope:'.length))) {
      return true;
    }
  }

  return false;
}

// -----------------------------------------------------------------------------
// Entity types
// -----------------------------------------------------------------------------

/**
 * GET /entity-types
 * List the type registry.
 */
entityTypesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const types = await entityService.listEntityTypes(tenantId);
    sendSuccess(res, types, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /entity-types  (admin)
 * Register a new type. Creating a type requires the admin tier.
 */
entityTypesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const dto = CreateEntityTypeSchema.parse(req.body);
    const type = await entityService.createEntityType(tenantId, dto, {
      isAdmin: isAdminContext(req),
    });
    sendCreated(res, type, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /entity-types/:type  (admin)
 * Merge-patch label/description/allowedParentTypes/isActive of a registered type.
 */
entityTypesRouter.patch('/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { type } = req.params;
    if (!type) {
      throw new ValidationError(ERR_TYPE_REQUIRED);
    }
    const dto = UpdateEntityTypeSchema.parse(req.body);
    const updated = await entityService.updateEntityType(tenantId, type, dto, {
      isAdmin: isAdminContext(req),
    });
    sendSuccess(res, updated, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /entity-types/:type  (admin)
 * Remove a type. Blocked (409 TYPE_IN_USE) while any entity references it.
 */
entityTypesRouter.delete('/:type', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const { type } = req.params;
    if (!type) {
      throw new ValidationError(ERR_TYPE_REQUIRED);
    }
    await entityService.deleteEntityType(tenantId, type, { isAdmin: isAdminContext(req) });
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Entities — list / resolve (static paths before /:id)
// -----------------------------------------------------------------------------

/**
 * GET /entities/resolve
 * Effective config for a customer (own rows if any, else system). Mirrors the
 * alarm-bundle versioning pattern: sets `X-Version-Id` = data.version; honors
 * `If-None-Match` -> 304 Not Modified (no body) when the version is unchanged.
 */
router.get('/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId, deep, state } = req.query;

    if (!customerId) {
      throw new ValidationError('customerId query param is required');
    }

    const result = await entityService.resolve(tenantId, customerId as string, {
      deep: parseDeep(deep),
      state: parseState(state),
    });

    res.setHeader('X-Version-Id', result.version);

    // 304 when the client's cached version matches. If-None-Match may arrive
    // quoted (`"v_…"`); compare against both the raw and the quoted form.
    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string') {
      const normalized = ifNoneMatch.replace(/^"(.*)"$/, '$1').trim();
      if (normalized === result.version) {
        res.status(304).end();
        return;
      }
    }

    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /entities
 * List / search with filters + pagination.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const query = ListEntitiesQuerySchema.parse(req.query);
    const result = await entityService.list(tenantId, query);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Clone / revert / bulk-replace (static collection-level mutations)
// -----------------------------------------------------------------------------

/**
 * POST /entities/clone
 * Materialize the whole system tree under a customer.
 */
router.post('/clone', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { customerId } = CloneSchema.parse(req.body);
    const result = await entityService.clone(tenantId, customerId, userId);
    sendCreated(res, result, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /entities/revert
 * Soft-delete all of a customer's rows -> resolution falls back to system.
 */
router.post('/revert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { customerId } = RevertSchema.parse(req.body);
    const result = await entityService.revert(tenantId, customerId, userId);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /entities/bulk-replace
 * Atomic whole-subtree replace for a (customerId, type). Optimistic concurrency
 * at the subtree level via the `If-Match` request header (the X-Version-Id of
 * the subtree being replaced). Sets `X-Version-Id` = the new version on success.
 */
router.put('/bulk-replace', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { customerId, type } = BulkReplaceQuerySchema.parse(req.query);
    const body = BulkReplaceSchema.parse(req.body);

    // If-Match carries the X-Version-Id of the subtree being replaced; may be
    // quoted. Pass the normalized value to the service for the subtree CAS.
    const rawIfMatch = req.headers['if-match'];
    const ifMatch =
      typeof rawIfMatch === 'string'
        ? rawIfMatch.replace(/^"(.*)"$/, '$1').trim()
        : undefined;

    const result = await entityService.bulkReplace(
      tenantId,
      customerId,
      type,
      body,
      ifMatch,
      userId,
    );

    res.setHeader('X-Version-Id', result.version);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Entities — create
// -----------------------------------------------------------------------------

/**
 * POST /entities
 * Create a node.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateEntitySchema.parse(req.body);
    const entity = await entityService.create(tenantId, data, userId, {
      isAdmin: isAdminContext(req),
    });
    sendCreated(res, entity, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Entities — per-id (dynamic paths last)
// -----------------------------------------------------------------------------

/**
 * GET /entities/:id/children
 * Direct children (or bounded subtree) of one node.
 */
router.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;
    if (!id) {
      throw new ValidationError(ERR_ID_REQUIRED);
    }
    const { deep, state } = req.query;
    const children = await entityService.getChildren(tenantId, id, {
      deep: parseDeep(deep) ?? 0,
      state: parseState(state),
    });
    sendSuccess(res, children, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /entities/:id
 * Fetch one node; `deep` controls embedded children.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;
    if (!id) {
      throw new ValidationError(ERR_ID_REQUIRED);
    }
    const { deep, state } = req.query;
    const entity = await entityService.getById(tenantId, id, {
      deep: parseDeep(deep) ?? 0,
      state: parseState(state),
    });
    sendSuccess(res, entity, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /entities/:id
 * Partial update; optimistic `version`. `?metadataMode=replace` swaps metadata
 * wholesale. Editing an `is_system` row requires the admin tier.
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;
    if (!id) {
      throw new ValidationError(ERR_ID_REQUIRED);
    }
    const data = UpdateEntitySchema.parse(req.body);
    const metadataMode = req.query.metadataMode === 'replace' ? 'replace' : 'merge';
    const entity = await entityService.update(tenantId, id, data, userId, {
      isAdmin: isAdminContext(req),
      metadataMode,
    });
    sendSuccess(res, entity, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /entities/:id
 * Soft delete (default); `?hard=true`, `?cascade=true`.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id } = req.params;
    if (!id) {
      throw new ValidationError(ERR_ID_REQUIRED);
    }
    const hard = req.query.hard === 'true';
    const cascade = req.query.cascade === 'true';
    await entityService.remove(tenantId, id, userId, { hard, cascade });
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /entities/:id/restore
 * Un-delete a soft-deleted node.
 */
router.post('/:id/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;
    if (!id) {
      throw new ValidationError(ERR_ID_REQUIRED);
    }
    const entity = await entityService.restore(tenantId, id, userId);
    sendSuccess(res, entity, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export { entityTypesRouter };
export default router;
