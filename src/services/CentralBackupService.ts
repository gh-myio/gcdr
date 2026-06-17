import { s3Storage } from '../infrastructure/storage/S3Storage';
import { centralBackupRepository } from '../repositories/CentralBackupRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { generateId } from '../shared/utils/idGenerator';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';
import { CreateCentralBackupDTO, ConfirmCentralBackupDTO } from '../dto/request/CentralBackupDTO';

// Presigned URL lifetimes. Upload is short (the central PUTs right away);
// download is longer to cover a restore/analysis pull.
const UPLOAD_URL_TTL_SECONDS = 900; // 15 min
const DOWNLOAD_URL_TTL_SECONDS = 3600; // 1 h

// Minimal structural deps so the service is unit-testable (mirrors CentralService's
// constructor-injection). Defaults wire the real singletons for production use.
type StorageDep = Pick<typeof s3Storage, 'bucket' | 'getPresignedUploadUrl' | 'getPresignedDownloadUrl'>;
type BackupRepoDep = Pick<
  typeof centralBackupRepository,
  'create' | 'getById' | 'listByCentral' | 'markAvailable'
>;
type CentralRepoDep = Pick<typeof centralRepository, 'getById'>;

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
   * integrity digest + size. Idempotent: re-confirming an AVAILABLE row is a
   * no-op.
   */
  async confirmBackup(
    tenantId: string,
    centralId: string,
    backupId: string,
    dto: ConfirmCentralBackupDTO,
  ) {
    const row = await this.backups.getById(tenantId, centralId, backupId);
    if (!row) throw new NotFoundError(`Backup ${backupId} not found for central ${centralId}`);
    if (row.status === 'AVAILABLE') return row;

    const updated = await this.backups.markAvailable(tenantId, backupId, dto.sha256, dto.byteSize);
    if (!updated) throw new NotFoundError(`Backup ${backupId} not found`);
    return updated;
  }

  async listBackups(tenantId: string, centralId: string) {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);
    return this.backups.listByCentral(tenantId, centralId);
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
