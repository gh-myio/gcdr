// Generic file/asset storage entity. Backs S3-compatible object storage and
// is intentionally polymorphic so any GCDR feature (wiki, PDF export, future
// avatars, customer logos, device manuals) can register a file without a
// per-feature table.
//
// Companion: docs/rfcs/RFC-0030-S3-Bucket-Setup.md (bucket, IAM, key layout).

export type FileAssetOwnerType =
  | 'wiki_page'                  // attachment of a wiki page (image, doc, etc.)
  | 'wiki_pdf'                   // rendered PDF artefact of a wiki page revision
  | 'free'                       // uploaded but not yet attached to anything
  // RFC-0032 — QR Checker module (migration 0024 extends the CHECK constraint).
  | 'wo_installation'           // installation photo
  | 'wo_customer_observation'   // photo on a customer-level QR observation
  | 'wo_visita_ambiente'        // photo of an environment in a Visita Técnica
  | 'wo_visita_product'         // photo of an inventoried product in a Visita
  | 'wo_visita_observation'     // photo on a visita-level observation
  // RFC-0037 event model + RFC-0036 annotations (migration 0033 extends the CHECK).
  | 'work_order'                // evidence linked to a work order
  | 'work_order_event'          // evidence linked to a specific WO event
  | 'annotation'                // attachment on an annotation
  | 'annotation_response';      // attachment on an annotation response

export const ALL_FILE_ASSET_OWNER_TYPES: readonly FileAssetOwnerType[] = [
  'wiki_page', 'wiki_pdf', 'free',
  'wo_installation', 'wo_customer_observation',
  'wo_visita_ambiente', 'wo_visita_product', 'wo_visita_observation',
  'work_order', 'work_order_event', 'annotation', 'annotation_response',
] as const;

export type FileAssetStatus =
  | 'PENDING_UPLOAD'   // metadata row created, S3 PUT not yet confirmed
  | 'ACTIVE'           // available for download
  | 'QUARANTINED'      // AV scan flagged it; download blocked
  | 'DELETED';         // soft delete; S3 lifecycle rule purges binary later

export type FileAssetScanStatus =
  | 'PENDING'          // not yet scanned
  | 'CLEAN'
  | 'INFECTED'         // moves status → QUARANTINED
  | 'SKIPPED';         // scan disabled or unsupported MIME

export type FileAssetStorageProvider = 'S3' | 'MINIO' | 'LOCAL';

export interface FileAsset {
  id: string;
  tenantId: string;
  customerId: string | null;

  ownerType: FileAssetOwnerType;
  /** Required for everything except `owner_type = 'free'`. UUID for most types; `text` for non-UUID owners (e.g. RFC numbers). */
  ownerId: string | null;

  filename: string;
  contentType: string;
  byteSize: number;
  /** Hex-encoded SHA-256 of the binary content (64 chars). */
  sha256: string;

  storageProvider: FileAssetStorageProvider;
  storageBucket: string;
  storageKey: string;

  status: FileAssetStatus;
  scanStatus: FileAssetScanStatus;

  uploadedBy: string;
  uploadedAt: string;     // ISO 8601
  deletedAt: string | null;

  /** Free-form: image dimensions, video duration, EXIF, page count, etc. */
  metadata: Record<string, unknown>;

  /**
   * Optional human-readable slug enabling stable, brand-friendly public URLs:
   *   GET /api/v1/public/files/by-slug/<publicSlug>
   * Unique per tenant among non-deleted rows. Format: same as wiki page slug
   * (`^[a-z0-9][a-z0-9/_-]{0,127}$`). Useful for catalog assets like icons,
   * logos, and reference images that need consistent URLs over time.
   */
  publicSlug: string | null;
}
