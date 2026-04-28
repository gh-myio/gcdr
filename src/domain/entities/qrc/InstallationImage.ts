// RFC-0032 — Installation image (thin join to file_assets).
//
// File bytes, sha256, S3 key, signed URL, etc. live in `file_assets`.
// This row holds only the QR-specific metadata: image ordering and caption.

export interface InstallationImage {
  id: string;
  tenantId: string;
  installationId: string;
  /** FK to file_assets.id (with owner_type='qrc_installation'). */
  fileAssetId: string;
  /** 0-based ordering within the installation; max 20 per installation. */
  imageOrder: number;
  caption: string | null;
  createdAt: string;
}
