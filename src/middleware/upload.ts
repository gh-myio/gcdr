import multer from 'multer';
import type { Request } from 'express';
import { ValidationError } from '../shared/errors/AppError';

// =============================================================================
// Multer middleware for multipart uploads.
//
// Memory storage is used so the buffer is available to compute SHA-256 and
// stream straight into S3 via @aws-sdk. For files larger than the configured
// S3_UPLOAD_MAX_BYTES we should use presigned PUT URLs (browser → S3 direct)
// — see s3Storage.getPresignedUploadUrl. That path is documented but not yet
// wired into a controller; v1 routes go through this multer middleware.
// =============================================================================

const SIZE_LIMIT_BYTES = (() => {
  const raw = process.env.S3_UPLOAD_MAX_BYTES;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 10 * 1024 * 1024;
})();

/**
 * Allowed MIME prefixes / exact types. Tighten as needs evolve. Keeping this
 * generous in v1 because the platform stores everything from images to PDFs
 * to CSV exports; the responsibility for "should this file be allowed for
 * THIS owner" lives in the service, not the middleware.
 */
const ACCEPTED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'text/',
  'application/pdf',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.',
  'application/msword',
  'application/vnd.ms-powerpoint',
];

function fileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const mime = (file.mimetype || '').toLowerCase();
  const ok = ACCEPTED_MIME_PREFIXES.some((p) => mime === p || mime.startsWith(p));
  if (!ok) {
    cb(new ValidationError(`Unsupported MIME type: ${file.mimetype}`));
    return;
  }
  cb(null, true);
}

export const uploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: SIZE_LIMIT_BYTES,
    files: 1,
  },
  fileFilter,
}).single('file');

/**
 * Express error-mapper for multer failures. Without this, multer raises raw
 * `MulterError` instances that the global error handler doesn't recognise.
 * Mount it AFTER the route that uses uploadSingleFile or wrap the handler.
 */
export function multerErrorAdapter(
  err: unknown,
  _req: Request,
  _res: unknown,
  next: (err?: unknown) => void,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      next(new ValidationError(
        `File too large — max ${(SIZE_LIMIT_BYTES / 1024 / 1024).toFixed(0)} MB`,
      ));
      return;
    }
    next(new ValidationError(`Upload failed: ${err.message}`));
    return;
  }
  next(err);
}

export const UPLOAD_MAX_BYTES = SIZE_LIMIT_BYTES;
