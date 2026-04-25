import { z } from 'zod';
import { PaginationParams } from '../../shared/types';

// =============================================================================
// File asset DTOs (RFC-0030 / RFC-0031 — generic file storage)
// =============================================================================

export const FileAssetOwnerTypeSchema = z.enum(['wiki_page', 'wiki_pdf', 'free']);
export const FileAssetStatusSchema     = z.enum(['PENDING_UPLOAD', 'ACTIVE', 'QUARANTINED', 'DELETED']);
export const FileAssetScanStatusSchema = z.enum(['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED']);

// Multipart bodies arrive with everything as strings — `metadata` is JSON-encoded.
export const CreateFileAssetSchema = z.object({
  ownerType:  FileAssetOwnerTypeSchema,
  ownerId:    z.string().min(1).max(256).optional(),
  customerId: z.string().uuid().optional(),
  metadata:   z.string().optional(),
}).refine(
  (d) => d.ownerType === 'free' || (typeof d.ownerId === 'string' && d.ownerId.length > 0),
  { message: 'ownerId is required when ownerType is not "free"', path: ['ownerId'] }
);
export type CreateFileAssetDTO = z.infer<typeof CreateFileAssetSchema>;

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
  ownerType?:  'wiki_page' | 'wiki_pdf' | 'free';
  ownerId?:    string;
  customerId?: string;
  status?:     'PENDING_UPLOAD' | 'ACTIVE' | 'QUARANTINED' | 'DELETED';
  scanStatus?: 'PENDING' | 'CLEAN' | 'INFECTED' | 'SKIPPED';
  /** Default false — soft-deleted rows are hidden. */
  includeDeleted?: boolean;
}
