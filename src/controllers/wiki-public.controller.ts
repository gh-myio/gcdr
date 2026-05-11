import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { wikiPageService } from '../services/WikiPageService';
import { wikiNamespaceRepository } from '../repositories/WikiPageRepository';
import { sendSuccess, sendCreated } from '../middleware';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';
import { rateLimit, clientIp } from '../middleware/rateLimit';
import { verifyTurnstileToken } from '../shared/utils/captchaVerifier';
import { PublicCreateIntegrationFromFormSchema } from '../dto/request/WikiDTO';

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

/**
 * POST /public/wiki/integrations/submit
 *
 * Anonymous form-driven submission for the Integrations namespace. Lands as
 * DRAFT with TENANT_PRIVATE visibility — invisible to anonymous visitors —
 * and waits for an authenticated admin to review and publish.
 *
 * Anti-abuse stack (matches RFC anti-spam for public-write endpoints):
 *   - Rate limit: 3 submissions / hour / IP (in-memory bucket)
 *   - Captcha: Cloudflare Turnstile token (verified server-side)
 *   - Honeypot: hidden `website` field must be empty
 *
 * The submitter's contact info (name/email/phone) is persisted in the page's
 * frontmatter for audit. Tenant is always the default tenant from
 * contextMiddleware (anonymous submissions all land in the same tenant).
 */
const submitIntegrationLimiter = rateLimit('wiki-public-integration-submit', {
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyFn: (req) => clientIp(req),
  message:
    'Limite de submissões atingido (3 por hora). Tente novamente mais tarde.',
});

router.post(
  '/integrations/submit',
  submitIntegrationLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, requestId } = req.context;
      const data = PublicCreateIntegrationFromFormSchema.parse(req.body);

      // Honeypot — bots fill every field. Real users never see this one.
      if (data.website && data.website.length > 0) {
        // Pretend success so the bot doesn't learn we caught it.
        res.status(202).json({
          success: true,
          data: { accepted: true },
          meta: { requestId, timestamp: new Date().toISOString() },
        });
        return;
      }

      const captcha = await verifyTurnstileToken(
        data.captchaToken,
        clientIp(req),
      );
      if (!captcha.success) {
        throw new ValidationError(
          `Captcha inválido (${(captcha.errorCodes ?? ['unknown']).join(', ')})`,
        );
      }

      const result = await wikiPageService.createPublicIntegrationSubmission(
        tenantId,
        data,
      );

      sendCreated(
        res,
        {
          submitted: true,
          pageId: result.page.id,
          namespace: result.page.namespace,
          slug: result.page.slug,
          // The page is held in DRAFT — we don't return a public URL because
          // there isn't one yet. The frontend renders a "thank you, awaiting
          // review" success state instead of navigating.
        },
        requestId,
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
