import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { fileAssetService } from '../services/FileAssetService';
import {
  CreateFileAssetSchema,
  ListFileAssetsParams,
  SetPublicSlugSchema,
} from '../dto/request/FileAssetDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware';
import { uploadSingleFile, multerErrorAdapter } from '../middleware/upload';
import { ValidationError, NotFoundError } from '../shared/errors/AppError';

// =============================================================================
// File Assets controller (RFC-0030 / RFC-0031)
// Mounted under /api/v1/assets. Authentication is required by app.ts.
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

function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') {
    throw new ValidationError('metadata must be a JSON object string');
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ValidationError('metadata must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ValidationError('metadata must be valid JSON');
  }
}

// -----------------------------------------------------------------------------
// POST /assets   — multipart upload (field name "file")
// -----------------------------------------------------------------------------
router.post('/',
  uploadSingleFile,
  multerErrorAdapter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;

      if (!req.file) {
        throw new ValidationError('Missing "file" field in multipart payload');
      }

      const data = CreateFileAssetSchema.parse({
        ownerType:  req.body.ownerType,
        ownerId:    req.body.ownerId,
        customerId: req.body.customerId,
        metadata:   req.body.metadata,
        publicSlug: req.body.publicSlug,
      });

      const metadata = parseMetadata(data.metadata);

      const { asset, downloadUrl } = await fileAssetService.upload({
        tenantId,
        userId,
        customerId: data.customerId ?? null,
        ownerType: data.ownerType,
        ownerId: data.ownerId ?? null,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        body: req.file.buffer,
        metadata,
        publicSlug: data.publicSlug ?? null,
      });

      sendCreated(res, { ...asset, downloadUrl }, requestId);
    } catch (err) {
      next(err);
    }
  }
);

// -----------------------------------------------------------------------------
// GET /assets    — list with filters
// -----------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor } = parsePagination(req);

    const OwnerTypeSchema = z.enum(['wiki_page', 'wiki_pdf', 'free']).optional();
    const StatusSchema    = z.enum(['PENDING_UPLOAD', 'ACTIVE', 'QUARANTINED', 'DELETED']).optional();
    const ScanSchema      = z.enum(['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED']).optional();

    const params: ListFileAssetsParams = {
      ownerType:      OwnerTypeSchema.parse(req.query.ownerType),
      ownerId:        (req.query.ownerId as string | undefined) || undefined,
      customerId:     (req.query.customerId as string | undefined) || undefined,
      status:         StatusSchema.parse(req.query.status),
      scanStatus:     ScanSchema.parse(req.query.scanStatus),
      includeDeleted: req.query.includeDeleted === 'true',
      limit,
      cursor,
    };

    const result = await fileAssetService.list(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// GET /assets/:id    — metadata only
// -----------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const asset = await fileAssetService.getById(tenantId, req.params.id);
    sendSuccess(res, asset, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// GET /assets/:id/download    — returns signed URL or 302 redirect
// -----------------------------------------------------------------------------
router.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    const DispositionSchema = z.enum(['inline', 'attachment']).optional();
    const ExpiresSchema     = z.coerce.number().int().min(30).max(3600).optional();

    const result = await fileAssetService.getDownloadUrl(tenantId, req.params.id, {
      disposition:      DispositionSchema.parse(req.query.disposition) ?? 'inline',
      expiresInSeconds: ExpiresSchema.parse(req.query.expiresInSeconds),
      filenameOverride: (req.query.filename as string | undefined) || undefined,
    });

    if (req.query.redirect === 'true') {
      // Redirect mode — convenient for <a href> downloads.
      res.redirect(302, result.url);
      return;
    }

    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// DELETE /assets/:id    — soft delete (binary purged by S3 lifecycle)
// -----------------------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    await fileAssetService.delete(tenantId, req.params.id);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// PATCH /:id/public-slug   — set / replace / clear the slug
// Body: { "publicSlug": "device-icons/escada-rolante" } or { "publicSlug": null }
// -----------------------------------------------------------------------------
router.patch('/:id/public-slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const data = SetPublicSlugSchema.parse(req.body ?? {});
    const asset = await fileAssetService.setPublicSlug(tenantId, req.params.id, data.publicSlug);
    sendSuccess(res, asset, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
