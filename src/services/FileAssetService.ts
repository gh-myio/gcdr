import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  fileAssetRepository,
} from '../repositories/FileAssetRepository';
import {
  IFileAssetRepository,
  CreateFileAssetInput,
} from '../repositories/interfaces/IFileAssetRepository';
import {
  FileAsset,
  FileAssetOwnerType,
} from '../domain/entities/FileAsset';
import { ListFileAssetsParams } from '../dto/request/FileAssetDTO';
import {
  s3Storage,
  S3Storage,
  detectStorageProvider,
  sha256Hex,
} from '../infrastructure/storage/S3Storage';
import {
  NotFoundError,
  ValidationError,
} from '../shared/errors/AppError';

// =============================================================================
// FileAssetService — generic upload/download/delete pipeline.
//
// Boundary of responsibility:
//   - Service does NOT enforce per-owner RBAC. Callers (controllers / domain
//     services like WikiPageService) are responsible for checking that the
//     caller may attach a file to a specific wiki page, customer, etc.
//   - Service DOES enforce tenant scoping, soft-delete semantics, sha256
//     integrity, and presigned URL generation.
// =============================================================================

export interface UploadInput {
  tenantId: string;
  userId: string;
  customerId?: string | null;
  ownerType: FileAssetOwnerType;
  ownerId?: string | null;
  filename: string;
  contentType: string;
  body: Buffer;
  metadata?: Record<string, unknown>;
}

export interface DownloadUrlOptions {
  /** Default 5min. Capped server-side at 1h. */
  expiresInSeconds?: number;
  /** 'inline' (default — render in browser) or 'attachment' (force save). */
  disposition?: 'inline' | 'attachment';
  /** Override download filename. Defaults to the asset's original filename. */
  filenameOverride?: string;
}

export interface DownloadUrlResult {
  url: string;
  expiresInSeconds: number;
  filename: string;
  contentType: string;
}

const MAX_PRESIGN_EXPIRES_SECONDS = 60 * 60; // 1 hour

function extOf(filename: string): string {
  const e = path.extname(filename);
  return e.startsWith('.') ? e.slice(1).toLowerCase() : e.toLowerCase();
}

function sanitizeFilenameForHeader(name: string): string {
  // RFC 6266: avoid characters that break Content-Disposition. Keep ASCII subset.
  return name.replace(/["\\\r\n]/g, '_');
}

function buildContentDisposition(
  asset: FileAsset,
  disposition: 'inline' | 'attachment',
  filenameOverride?: string,
): string {
  const filename = sanitizeFilenameForHeader(filenameOverride ?? asset.filename);
  return `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export class FileAssetService {
  constructor(
    private readonly repo: IFileAssetRepository = fileAssetRepository,
    private readonly storage: S3Storage = s3Storage,
  ) {}

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  async upload(input: UploadInput): Promise<{ asset: FileAsset; downloadUrl: string }> {
    if (!input.body || input.body.byteLength === 0) {
      throw new ValidationError('Empty file body');
    }
    if (input.body.byteLength > this.storage.config.uploadMaxBytes) {
      throw new ValidationError(
        `File too large — max ${this.storage.config.uploadMaxBytes} bytes`,
      );
    }
    if (input.ownerType !== 'free' && (!input.ownerId || input.ownerId.length === 0)) {
      throw new ValidationError(`ownerId is required when ownerType is "${input.ownerType}"`);
    }

    const id = randomUUID();
    const ext = extOf(input.filename);

    // 1. Compute sha256 locally — content-addressing key needs it before upload.
    const sha256 = sha256Hex(input.body);
    const canonicalKey = this.storage.buildAssetKey({
      tenantId: input.tenantId,
      assetId: id,
      sha256,
      ext,
    });

    // 2. Single PUT to S3.
    const putResult = await this.storage.putObject({
      key: canonicalKey,
      body: input.body,
      contentType: input.contentType,
    });

    // Sanity check — S3 should never return a different size, but defend.
    if (putResult.sha256 !== sha256 || putResult.byteSize !== input.body.byteLength) {
      await this.storage.deleteObject(canonicalKey).catch(() => undefined);
      throw new ValidationError('Upload integrity check failed');
    }

    // 3. Persist metadata row.
    const createInput: CreateFileAssetInput = {
      id,
      tenantId: input.tenantId,
      customerId: input.customerId ?? null,
      ownerType: input.ownerType,
      ownerId: input.ownerId ?? null,
      filename: input.filename,
      contentType: input.contentType,
      byteSize: putResult.byteSize,
      sha256: putResult.sha256,
      storageProvider: detectStorageProvider(this.storage.config.endpoint),
      storageBucket: this.storage.config.bucket,
      storageKey: canonicalKey,
      status: 'ACTIVE',
      scanStatus: 'PENDING',
      uploadedBy: input.userId,
      metadata: input.metadata ?? {},
    };

    let asset: FileAsset;
    try {
      asset = await this.repo.create(createInput);
    } catch (err) {
      // DB failed after S3 already has the binary — clean up to avoid orphans.
      await this.storage.deleteObject(canonicalKey).catch(() => undefined);
      throw err;
    }

    const url = await this.storage.getPresignedDownloadUrl({
      key: canonicalKey,
      expiresInSeconds: 300,
      responseContentDisposition: buildContentDisposition(asset, 'inline'),
      responseContentType: asset.contentType,
    });

    return { asset, downloadUrl: url };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getById(tenantId: string, id: string): Promise<FileAsset> {
    const asset = await this.repo.getById(tenantId, id);
    if (!asset || asset.deletedAt) {
      throw new NotFoundError(`File asset ${id} not found`);
    }
    return asset;
  }

  async list(tenantId: string, params?: ListFileAssetsParams) {
    return this.repo.list(tenantId, params);
  }

  async getDownloadUrl(
    tenantId: string,
    id: string,
    options: DownloadUrlOptions = {},
  ): Promise<DownloadUrlResult> {
    const asset = await this.getById(tenantId, id);

    if (asset.status === 'QUARANTINED') {
      throw new ValidationError('Asset is quarantined and cannot be downloaded');
    }

    const expires = Math.min(
      Math.max(options.expiresInSeconds ?? 300, 30),
      MAX_PRESIGN_EXPIRES_SECONDS,
    );
    const disposition = options.disposition ?? 'inline';
    const filename = options.filenameOverride ?? asset.filename;

    const url = await this.storage.getPresignedDownloadUrl({
      key: asset.storageKey,
      expiresInSeconds: expires,
      responseContentDisposition: buildContentDisposition(asset, disposition, filename),
      responseContentType: asset.contentType,
    });

    return {
      url,
      expiresInSeconds: expires,
      filename,
      contentType: asset.contentType,
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async delete(tenantId: string, id: string): Promise<void> {
    // Soft-delete only — S3 lifecycle rule purges binaries on its own schedule
    // (see RFC-0030-S3-Bucket-Setup, lifecycle "deleted-purge" 30d).
    await this.repo.softDelete(tenantId, id);
  }

  async setScanStatus(
    tenantId: string,
    id: string,
    scanStatus: 'CLEAN' | 'INFECTED' | 'SKIPPED',
  ): Promise<FileAsset> {
    // INFECTED → also flip status to QUARANTINED (downloads blocked).
    const patch =
      scanStatus === 'INFECTED'
        ? { scanStatus, status: 'QUARANTINED' as const }
        : { scanStatus };
    return this.repo.update(tenantId, id, patch);
  }
}

export const fileAssetService = new FileAssetService();
