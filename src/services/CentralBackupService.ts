import { s3Storage } from '../infrastructure/storage/S3Storage';
import { centralBackupRepository } from '../repositories/CentralBackupRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { generateId } from '../shared/utils/idGenerator';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';
import { CreateCentralBackupDTO, ConfirmCentralBackupDTO } from '../dto/request/CentralBackupDTO';
import { PaginatedResult } from '../shared/types';
import { CentralBackup } from '../infrastructure/database/drizzle/db';

// Presigned URL lifetimes. A multi-GB dump over a 4G site link can outrun a
// 15-min window, so the upload TTL is 1h and reissueUploadUrl() re-mints it for
// the SAME key without orphaning a row (CR-S9).
const UPLOAD_URL_TTL_SECONDS = 3600; // 1 h
const DOWNLOAD_URL_TTL_SECONDS = 3600; // 1 h

// Minimal structural deps so the service is unit-testable (mirrors CentralService's
// constructor-injection). Defaults wire the real singletons for production use.
type StorageDep = Pick<
  typeof s3Storage,
  'bucket' | 'getPresignedUploadUrl' | 'getPresignedDownloadUrl' | 'headObject'
>;
type BackupRepoDep = Pick<
  typeof centralBackupRepository,
  'create' | 'getById' | 'listByCentralPaged' | 'markAvailable'
>;
type CentralRepoDep = Pick<typeof centralRepository, 'getById'>;

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Backup/restore brokerage for centrals. gcdr does NOT run pg_dump/pg_restore:
 * the central runs them on its own embedded Postgres/TimescaleDB. This service
 * only hands out presigned S3 URLs and tracks the `central_backups` lifecycle.
 *
 * Phase 1 (this file): standalone backup + download (also serves the
 * "download a central's backup for analysis without swapping" use case).
 * Phase 2 adds the restore job + identity hand-off (swap).
 */
export class CentralBackupService {
  constructor(
    private readonly storage: StorageDep = s3Storage,
    private readonly backups: BackupRepoDep = centralBackupRepository,
    private readonly centrals: CentralRepoDep = centralRepository,
  ) {}

  /**
   * Request a new backup slot: validates the central, mints a storage key +
   * presigned PUT URL, and records a PENDING row. The central uploads the dump
   * to `uploadUrl`, then calls confirmBackup().
   */
  async createBackup(
    tenantId: string,
    centralId: string,
    userId: string | undefined,
    dto: CreateCentralBackupDTO,
  ) {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    const backupId = generateId();
    const storageKey = `backups/${tenantId}/${centralId}/${backupId}.pgdump.custom`;
    const bucket = this.storage.bucket;

    const uploadUrl = await this.storage.getPresignedUploadUrl({
      key: storageKey,
      contentType: 'application/octet-stream',
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    const row = await this.backups.create({
      id: backupId,
      tenantId,
      centralId,
      storageKey,
      bucket,
      sourceLabel: dto.sourceLabel ?? 'manual',
      createdBy: userId ?? null,
    });

    return {
      backupId: row.id,
      centralId,
      status: row.status,
      uploadUrl,
      storageKey,
      bucket,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    };
  }

  /**
   * Mark a backup AVAILABLE once the central finished the upload, recording the
   * integrity digest + size.
   *
   * CR-S4: before flipping to AVAILABLE, gcdr HeadObjects the storage key to
   * confirm the object actually landed and its size matches the central's
   * report — so a buggy/compromised central can't mark a never-uploaded or
   * truncated dump AVAILABLE (the field-swap restore would then pull a corrupt
   * backup at the worst moment). S3 can't cheaply verify sha256 server-side
   * (ETag != sha256 for multipart), so the sha256 is stored for the central to
   * re-verify at restore time while the SIZE is authoritatively cross-checked
   * here. Idempotent: a re-confirm of an AVAILABLE row (network retry) is a
   * clean no-op; a FAILED/EXPIRED row is a deterministic 400, never a 500.
   */
  async confirmBackup(
    tenantId: string,
    centralId: string,
    backupId: string,
    dto: ConfirmCentralBackupDTO,
  ) {
    const row = await this.backups.getById(tenantId, centralId, backupId);
    if (!row) throw new NotFoundError(`Backup ${backupId} not found for central ${centralId}`);
    if (row.status === 'AVAILABLE') return row; // idempotent no-op
    if (row.status !== 'PENDING') {
      throw new ValidationError(`Backup ${backupId} is ${row.status}; request a new backup slot`);
    }

    const head = await this.storage.headObject(row.storageKey);
    if (!head) {
      throw new ValidationError('Backup object not found in storage; the upload did not complete');
    }
    if (head.byteSize !== dto.byteSize) {
      throw new ValidationError(
        `Backup byteSize mismatch: reported ${dto.byteSize}, storage has ${head.byteSize}`,
      );
    }

    const updated = await this.backups.markAvailable(tenantId, backupId, dto.sha256, dto.byteSize);
    if (!updated) throw new NotFoundError(`Backup ${backupId} not found`);
    return updated;
  }

  /**
   * Re-mint the presigned PUT URL for an existing PENDING backup — SAME storage
   * key, NO new row (CR-S9) — so a central whose upload outran the URL TTL can
   * retry without orphaning a backup row. Refuses an already-confirmed or dead
   * backup.
   */
  async reissueUploadUrl(tenantId: string, centralId: string, backupId: string) {
    const row = await this.backups.getById(tenantId, centralId, backupId);
    if (!row) throw new NotFoundError(`Backup ${backupId} not found for central ${centralId}`);
    if (row.status === 'AVAILABLE') {
      throw new ValidationError(`Backup ${backupId} is already confirmed`);
    }
    if (row.status !== 'PENDING') {
      throw new ValidationError(`Backup ${backupId} is ${row.status}; request a new backup slot`);
    }

    const uploadUrl = await this.storage.getPresignedUploadUrl({
      key: row.storageKey,
      contentType: 'application/octet-stream',
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return {
      backupId: row.id,
      uploadUrl,
      storageKey: row.storageKey,
      bucket: row.bucket,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    };
  }

  async listBackups(
    tenantId: string,
    centralId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<PaginatedResult<CentralBackup>> {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
    const page = Math.max(1, opts.page ?? 1);
    const offset = (page - 1) * limit;

    const { items, total } = await this.backups.listByCentralPaged(tenantId, centralId, {
      limit,
      offset,
    });
    return {
      items,
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + items.length < total,
      },
    };
  }

  /**
   * Mint a presigned GET URL for an AVAILABLE backup — used both by an admin
   * downloading for analysis and by a replacement central restoring (swap).
   */
  async getDownloadUrl(tenantId: string, centralId: string, backupId: string) {
    const row = await this.backups.getById(tenantId, centralId, backupId);
    if (!row) throw new NotFoundError(`Backup ${backupId} not found for central ${centralId}`);
    if (row.status !== 'AVAILABLE') {
      throw new ValidationError(`Backup ${backupId} is not downloadable (status=${row.status})`);
    }

    const downloadUrl = await this.storage.getPresignedDownloadUrl({
      key: row.storageKey,
      responseContentType: 'application/octet-stream',
      responseContentDisposition: `attachment; filename="central-${centralId}-${backupId}.pgdump.custom"`,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });

    return {
      backupId: row.id,
      downloadUrl,
      sha256: row.sha256,
      byteSize: row.byteSize,
      storageKey: row.storageKey,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    };
  }
}

export const centralBackupService = new CentralBackupService();
