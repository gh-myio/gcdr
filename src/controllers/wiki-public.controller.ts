import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { wikiPageService } from '../services/WikiPageService';
import { wikiNamespaceRepository } from '../repositories/WikiPageRepository';
import { sendSuccess } from '../middleware';
import { NotFoundError } from '../shared/errors/AppError';

// =============================================================================
// RFC-0030 — Public (anonymous) Wiki
//
// Mounted under /api/v1/public/wiki, WITHOUT authMiddleware. Every endpoint
// forces:
//   visibility  ⊇ PUBLIC
//   status      = PUBLISHED
//
// Tenant scoping comes from the X-Tenant-Id request header (same as the rest
// of the platform), with the default-tenant fallback applied by
// contextMiddleware. Anonymous users therefore always land in a single tenant.
// =============================================================================

const router = Router();

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

/**
 * GET /public/wiki/namespaces
 */
router.get('/namespaces', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const items = await wikiNamespaceRepository.list(tenantId);
    sendSuccess(res, { items, total: items.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public/wiki/pages
 */
router.get('/pages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor } = parsePagination(req);
    const result = await wikiPageService.listPublic(tenantId, {
      namespace: req.query.namespace as string | undefined,
      tag: req.query.tag as string | undefined,
      q: req.query.q as string | undefined,
      limit,
      cursor,
    });
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public/wiki/pages/by-slug/:namespace/:slug
 */
router.get('/pages/by-slug/:namespace/:slug(*)', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const page = await wikiPageService.getPublicPageBySlug(
      tenantId,
      req.params.namespace,
      req.params.slug,
    );
    sendSuccess(res, page, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public/wiki/pages/:id
 */
router.get('/pages/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const page = await wikiPageService.getPublicPageById(tenantId, req.params.id);
    sendSuccess(res, page, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public/wiki/search
 */
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const q = (req.query.q as string | undefined)?.trim();
    if (!q) {
      sendSuccess(res, { items: [], pagination: { total: 0, totalPages: 0, hasMore: false } }, 200, requestId);
      return;
    }
    const { limit, cursor } = parsePagination(req);
    const tagsRaw = req.query.tags;
    const tags = Array.isArray(tagsRaw)
      ? (tagsRaw as string[])
      : typeof tagsRaw === 'string' ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

    const result = await wikiPageService.searchPublic(tenantId, {
      q,
      namespace: req.query.namespace as string | undefined,
      tags,
      status: 'PUBLISHED',
      limit,
      cursor,
    });
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /public/wiki/backlinks
 */
router.get('/backlinks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
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
    const result = await wikiPageService.backlinksPublic(tenantId, {
      entityType: parsedType,
      entityId,
      limit,
      cursor,
    });
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
