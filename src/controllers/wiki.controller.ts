import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { wikiPageService } from '../services/WikiPageService';
import { wikiAudienceResolver } from '../services/WikiAudienceResolver';
import { wikiAccessAuditService } from '../services/WikiAccessAuditService';
import { wikiNamespaceRepository } from '../repositories/WikiPageRepository';
import {
  CreatePageSchema,
  UpdatePageSchema,
  MovePageSchema,
  PublishPageSchema,
  CreateNamespaceSchema,
  UpdateNamespaceSchema,
  CreateIntegrationFromFormSchema,
  ListPagesParams,
} from '../dto/request/WikiDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware';
import { ConflictError, NotFoundError } from '../shared/errors/AppError';

// =============================================================================
// RFC-0030: MYIO Wiki (Knowledge Base Module) — Phase 1 controller
//
// Mounted under /api/v1/wiki. Authentication is applied at the app-level
// (authMiddleware); RBAC for individual actions (wiki.page.*, wiki.namespace.*,
// wiki.visibility.*) is enforced by the service layer via the authorization
// service.
// =============================================================================

const router = Router();

// -----------------------------------------------------------------------------
// Helper — parse pagination from query
// -----------------------------------------------------------------------------

function parsePagination(req: Request): { limit: number; cursor?: string } {
  const { limit, cursor, page, pageSize } = req.query;
  const resolvedLimit = pageSize
    ? parseInt(pageSize as string, 10)
    : limit ? parseInt(limit as string, 10) : 20;
  const resolvedCursor = page
    ? String((parseInt(page as string, 10) - 1) * resolvedLimit)
    : (cursor as string | undefined);
  return { limit: resolvedLimit, cursor: resolvedCursor };
}

// -----------------------------------------------------------------------------
// Visibility endpoints — must come before /:id patterns
// -----------------------------------------------------------------------------

/**
 * GET /wiki/visibility/options
 * Returns the audience tags and named presets the current user is allowed to set.
 */
router.get('/visibility/options', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const options = await wikiAudienceResolver.getAllowedVisibilityOptions(tenantId, userId);
    sendSuccess(res, options, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /wiki/visibility/me
 * Returns the current user's effective audience list (for debugging / UI hints).
 */
router.get('/visibility/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const effective = await wikiAudienceResolver.resolveForUser(tenantId, userId);
    sendSuccess(res, effective, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Namespaces
// -----------------------------------------------------------------------------

router.get('/namespaces', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await wikiNamespaceRepository.list(tenantId);
    sendSuccess(res, { items, total: items.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

router.post('/namespaces', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = CreateNamespaceSchema.parse(req.body);
    // Conflict check — primary-key violation on insert would also catch it,
    // but we surface a cleaner 409 here.
    const existing = await wikiNamespaceRepository.get(tenantId, data.name);
    if (existing) throw new ConflictError(`Namespace '${data.name}' already exists`);
    const ns = await wikiNamespaceRepository.create(tenantId, data);
    sendCreated(res, ns, requestId);
  } catch (err) {
    next(err);
  }
});

router.patch('/namespaces/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = UpdateNamespaceSchema.parse(req.body);
    const ns = await wikiNamespaceRepository.update(tenantId, req.params.name, data);
    sendSuccess(res, ns, 200, requestId);
  } catch (err) {
    next(err);
  }
});

router.delete('/namespaces/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const count = await wikiNamespaceRepository.countPages(tenantId, req.params.name);
    if (count > 0) {
      throw new ConflictError(
        `Cannot delete namespace '${req.params.name}': ${count} page(s) still present`
      );
    }
    await wikiNamespaceRepository.delete(tenantId, req.params.name);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Access audit (for FE diagnostic UI)
// -----------------------------------------------------------------------------

/**
 * GET /wiki/access-check/:userId
 *
 * Returns a structured audit of the target user's wiki write access:
 *   - user identity
 *   - active role assignments
 *   - roles + their policy keys
 *   - policies with wiki.* allow/deny filtered out
 *   - aggregated effective wiki.* allow + deny lists
 *   - per-permission verdict (ALLOWED / DENIED / NOT_GRANTED) for the 16
 *     wiki permissions that matter for write/publish flows
 *   - summary specific to POST /wiki/integrations/from-form
 *
 * The audit runs in the caller's tenant (req.context.tenantId).
 * If the target user lives in another tenant, returns 404.
 */
const UserIdSchema = z.string().uuid();

router.get('/access-check/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const userId = UserIdSchema.parse(req.params.userId);
    const report = await wikiAccessAuditService.auditUser(tenantId, userId);
    sendSuccess(res, report, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Integrations form helper
// -----------------------------------------------------------------------------

/**
 * POST /wiki/integrations/from-form
 *
 * Form-driven creation of a Wiki page in the `Integrations` namespace.
 * The Markdown body is generated from the structured payload using the
 * canonical layout (descrição, motivação, custo, usuários suportados, URL,
 * API, etc.). The page is forced to:
 *   - namespace  = 'Integrations'
 *   - visibility = ['PUBLIC']
 *   - status     = 'PUBLISHED'
 *
 * The caller still needs permission to assign the PUBLIC audience tag.
 */
router.post('/integrations/from-form', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateIntegrationFromFormSchema.parse(req.body);
    const result = await wikiPageService.createIntegrationFromForm(
      { tenantId, userId },
      data,
    );
    sendCreated(res, {
      ...result.page,
      currentRevision: result.revision,
    }, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Pages
// -----------------------------------------------------------------------------

/**
 * POST /wiki/pages
 * Create a new page (first revision is persisted atomically).
 */
router.post('/pages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreatePageSchema.parse(req.body);
    const result = await wikiPageService.createPage({ tenantId, userId }, data);
    sendCreated(res, {
      ...result.page,
      extractedLinks: [], // populated in Phase 2
    }, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /wiki/pages
 * List pages visible to the current user (audience filter applied at repo).
 */
router.get('/pages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { limit, cursor } = parsePagination(req);

    const StatusSchema = z.enum(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED']).optional();

    const params: ListPagesParams = {
      namespace: req.query.namespace as string | undefined,
      status: StatusSchema.parse(req.query.status),
      tag: req.query.tag as string | undefined,
      q: req.query.q as string | undefined,
      includeDeleted: req.query.includeDeleted === 'true',
      includeDrafts: req.query.includeDrafts === 'true',
      limit,
      cursor,
    };

    const result = await wikiPageService.listPages({ tenantId, userId, params });
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /wiki/pages/by-slug/:namespace/:slug
 * Canonical-path lookup. Note that slugs may contain `/` — express wildcards
 * handle the remaining segments.
 */
router.get('/pages/by-slug/:namespace/:slug(*)',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const page = await wikiPageService.getPageBySlug(
        { tenantId, userId },
        req.params.namespace,
        req.params.slug,
      );
      sendSuccess(res, page, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /wiki/pages/:id
 */
router.get('/pages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const page = await wikiPageService.getPageById({ tenantId, userId }, req.params.id);
    sendSuccess(res, page, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /wiki/pages/:id
 * Append a new revision and update page metadata atomically.
 */
router.put('/pages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = UpdatePageSchema.parse(req.body);
    const result = await wikiPageService.updatePage({ tenantId, userId }, req.params.id, data);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /wiki/pages/:id/move
 */
router.patch('/pages/:id/move', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = MovePageSchema.parse(req.body);
    const page = await wikiPageService.movePage({ tenantId, userId }, req.params.id, data);
    sendSuccess(res, page, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /wiki/pages/:id/publish
 */
router.post('/pages/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = PublishPageSchema.parse(req.body ?? {});
    const page = await wikiPageService.publishPage({ tenantId, userId }, req.params.id, data);
    sendSuccess(res, page, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /wiki/pages/:id/archive
 */
router.post('/pages/:id/archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const page = await wikiPageService.archivePage({ tenantId, userId }, req.params.id);
    sendSuccess(res, page, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /wiki/pages/:id
 */
router.delete('/pages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    await wikiPageService.deletePage({ tenantId, userId }, req.params.id);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Revisions
// -----------------------------------------------------------------------------

router.get('/pages/:id/revisions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { limit, cursor } = parsePagination(req);
    const result = await wikiPageService.listRevisions(
      { tenantId, userId },
      req.params.id,
      { limit, cursor },
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

router.get('/pages/:id/revisions/:revisionNumber', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const revisionNumber = parseInt(req.params.revisionNumber, 10);
    if (!Number.isFinite(revisionNumber) || revisionNumber < 1) {
      throw new NotFoundError(`Invalid revision number`);
    }
    const rev = await wikiPageService.getRevision(
      { tenantId, userId },
      req.params.id,
      revisionNumber,
    );
    sendSuccess(res, rev, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /wiki/pages/:id/revisions/:a/diff/:b
 * Unified diff between two revisions.
 */
router.get('/pages/:id/revisions/:a/diff/:b', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const a = parseInt(req.params.a, 10);
    const b = parseInt(req.params.b, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1) {
      throw new NotFoundError(`Invalid revision number`);
    }
    const result = await wikiPageService.getRevisionDiff(
      { tenantId, userId },
      req.params.id,
      a,
      b,
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /wiki/pages/:id/revisions/:revisionNumber/rollback
 * Create a new revision that copies the body/title/frontmatter of an older one.
 */
router.post('/pages/:id/revisions/:revisionNumber/rollback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const revisionNumber = parseInt(req.params.revisionNumber, 10);
    if (!Number.isFinite(revisionNumber) || revisionNumber < 1) {
      throw new NotFoundError(`Invalid revision number`);
    }
    const note = typeof req.body?.changeNote === 'string' ? req.body.changeNote : undefined;
    const result = await wikiPageService.rollback(
      { tenantId, userId },
      req.params.id,
      revisionNumber,
      note,
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Search
// -----------------------------------------------------------------------------

router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const q = (req.query.q as string | undefined)?.trim();
    if (!q) {
      sendSuccess(res, { items: [], pagination: { total: 0, totalPages: 0, hasMore: false } }, 200, requestId);
      return;
    }

    const { limit, cursor } = parsePagination(req);
    const StatusSchema = z.enum(['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED']).optional();

    const tagsRaw = req.query.tags;
    const tags = Array.isArray(tagsRaw)
      ? (tagsRaw as string[])
      : typeof tagsRaw === 'string' ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

    const result = await wikiPageService.search(
      { tenantId, userId },
      {
        q,
        namespace: req.query.namespace as string | undefined,
        tags,
        status: StatusSchema.parse(req.query.status),
        limit,
        cursor,
      },
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Backlinks
// -----------------------------------------------------------------------------

router.get('/backlinks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const entity = req.query.entity as string | undefined;
    if (!entity || !entity.includes(':')) {
      throw new NotFoundError(`Invalid entity reference (expected 'type:id')`);
    }
    const [entityType, entityId] = entity.split(':', 2);
    const EntityTypeSchema = z.enum([
      'device','customer','rule','asset','central','group','user','rfc',
    ]);
    const parsedType = EntityTypeSchema.parse(entityType);

    const { limit, cursor } = parsePagination(req);
    const result = await wikiPageService.backlinks(
      { tenantId, userId },
      { entityType: parsedType, entityId, limit, cursor },
    );
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
