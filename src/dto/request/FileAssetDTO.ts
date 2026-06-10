import { z } from 'zod';
import { PaginationParams } from '../../shared/types';

// =============================================================================
// File asset DTOs (RFC-0030 / RFC-0031 — generic file storage)
// =============================================================================

export const FileAssetOwnerTypeSchema = z.enum([
  'wiki_page', 'wiki_pdf', 'free',
  'wo_installation', 'wo_customer_observation',
  'wo_visita_ambiente', 'wo_visita_product', 'wo_visita_observation',
  // RFC-0037 / RFC-0036 owners (CHECK extended by migration 0033)
  'work_order', 'work_order_event', 'annotation', 'annotation_response',
]);
export const FileAssetStatusSchema     = z.enum(['PENDING_UPLOAD', 'ACTIVE', 'QUARANTINED', 'DELETED']);
export const FileAssetScanStatusSchema = z.enum(['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED']);

// Slug shape used both as creation form input and as PATCH body.
// Mirrors the wiki page slug: kebab-case-with-slashes, max 128 chars.
export const PublicSlugSchema = z.string().regex(
  /^[a-z0-9][a-z0-9/_-]{0,127}$/,
  'publicSlug must match ^[a-z0-9][a-z0-9/_-]{0,127}$'
);

// Multipart bodies arrive with everything as strings — `metadata` is JSON-encoded.
export const CreateFileAssetSchema = z.object({
  ownerType:  FileAssetOwnerTypeSchema,
  ownerId:    z.string().min(1).max(256).optional(),
  customerId: z.string().uuid().optional(),
  metadata:   z.string().optional(),
  publicSlug: PublicSlugSchema.optional(),
}).refine(
  (d) => d.ownerType === 'free' || (typeof d.ownerId === 'string' && d.ownerId.length > 0),
  { message: 'ownerId is required when ownerType is not "free"', path: ['ownerId'] }
);
export type CreateFileAssetDTO = z.infer<typeof CreateFileAssetSchema>;

// PATCH /files/:id/public-slug — sets, replaces, or clears the slug.
// Pass `null` to remove the slug. Conflict (409) if another non-deleted row
// in the same tenant already holds it.
export const SetPublicSlugSchema = z.object({
  publicSlug: PublicSlugSchema.nullable(),
});
export type SetPublicSlugDTO = z.infer<typeof SetPublicSlugSchema>;

export const UpdateFileAssetMetaSchema = z.object({
  metadata: z.record(z.unknown()).optional(),
  ownerType: FileAssetOwnerTypeSchema.optional(),
  ownerId:   z.string().min(1).max(256).nullable().optional(),
  scanStatus: FileAssetScanStatusSchema.optional(),
  status:     FileAssetStatusSchema.optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'at least one field must be provided' }
);
export type UpdateFileAssetMetaDTO = z.infer<typeof UpdateFileAssetMetaSchema>;

export interface ListFileAssetsParams extends PaginationParams {
  ownerType?:  z.infer<typeof FileAssetOwnerTypeSchema>;
  ownerId?:    string;
  customerId?: string;
  status?:     'PENDING_UPLOAD' | 'ACTIVE' | 'QUARANTINED' | 'DELETED';
  scanStatus?: 'PENDING' | 'CLEAN' | 'INFECTED' | 'SKIPPED';
  /** Default false — soft-deleted rows are hidden. */
  includeDeleted?: boolean;
}
