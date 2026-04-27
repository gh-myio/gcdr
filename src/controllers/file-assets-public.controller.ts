import { Router, Request, Response, NextFunction } from 'express';
import { fileAssetService } from '../services/FileAssetService';
import { sendSuccess } from '../middleware';
import { ValidationError, NotFoundError } from '../shared/errors/AppError';
import { z } from 'zod';

// =============================================================================
// File Assets — public-by-slug router
//
// Mounted under /api/v1/public/files WITHOUT authMiddleware. Only assets with
// a `public_slug` set and `status = ACTIVE` are reachable. The slug acts as
// the implicit "this asset is public-by-design" marker: any code path that
// assigns a slug is implicitly opting the file into public visibility.
//
// Tenant scoping comes from the X-Tenant-Id header (with default-tenant
// fallback), same pattern as /api/v1/public/wiki.
// =============================================================================

const router = Router();

const QuerySchema = z.object({
  disposition:      z.enum(['inline', 'attachment']).optional(),
  expiresInSeconds: z.coerce.number().int().min(30).max(3600).optional(),
  filename:         z.string().min(1).max(256).optional(),
  redirect:         z.enum(['true', 'false']).optional(),
});

/**
 * GET /api/v1/public/files/by-slug/:slug
 *
 * Slug may contain `/` (e.g. `device-icons/escada-rolante`) — the express
 * wildcard captures everything after `by-slug/`.
 *
 * Response:
 *   - default: JSON with a fresh signed URL
 *   - ?redirect=true: 302 redirect to the signed URL (good for <img src>)
 */
router.get('/by-slug/:slug(*)', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const slug = req.params.slug;
    if (!slug) throw new NotFoundError('Slug is empty');

    const opts = QuerySchema.parse(req.query);

    const result = await fileAssetService.getPublicDownloadUrlBySlug(tenantId, slug, {
      disposition: opts.disposition ?? 'inline',
      expiresInSeconds: opts.expiresInSeconds,
      filenameOverride: opts.filename,
    });

    if (opts.redirect === 'true') {
      res.redirect(302, result.url);
      return;
    }

    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
