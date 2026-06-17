import { s3Storage } from '../infrastructure/storage/S3Storage';
import {
  centralRestoreJobRepository,
  RestoreLogEntry,
  UpdateRestoreJobPatch,
} from '../repositories/CentralRestoreJobRepository';
import { centralBackupRepository } from '../repositories/CentralBackupRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';
import { StartRestoreDTO, UpdateRestoreProgressDTO } from '../dto/request/CentralRestoreDTO';

const DOWNLOAD_URL_TTL_SECONDS = 3600; // 1 h — central downloads the dump
const TERMINAL_STATUSES = new Set(['DONE', 'FAILED', 'CANCELED']);

// Structural deps for unit testing (mirrors CentralBackupService DI).
type RestoreRepoDep = Pick<
  typeof centralRestoreJobRepository,
  'create' | 'getById' | 'listByCentral' | 'update'
>;
type BackupRepoDep = Pick<typeof centralBackupRepository, 'getById'>;
type StorageDep = Pick<typeof s3Storage, 'getPresignedDownloadUrl'>;
type CentralRepoDep = Pick<typeof centralRepository, 'getById'>;

/**
 * Restore brokerage for the field-swap. The replacement central adopts the same
 * serial+UUID, so a restore targets a central using one of ITS OWN backups.
 *
 * gcdr does NOT run pg_restore — it creates the job (QUEUED), hands the central
 * a presigned download URL for the backup, and tracks the phase progress the
 * central reports (DOWNLOAD -> VERIFY -> STOP_SERVICES -> RESTORE_DB ->
 * START_SERVICES -> DONE).
 */
export class CentralRestoreService {
  constructor(
    private readonly jobs: RestoreRepoDep = centralRestoreJobRepository,
    private readonly backups: BackupRepoDep = centralBackupRepository,
    private readonly storage: StorageDep = s3Storage,
    private readonly centrals: CentralRepoDep = centralRepository,
  ) {}

  /**
   * Start a restore of `centralId` from one of its AVAILABLE backups. Returns
   * the job + a presigned download URL the central uses to fetch the dump.
   */
  async startRestore(
    tenantId: string,
    centralId: string,
    userId: string | undefined,
    dto: StartRestoreDTO,
  ) {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    const backup = await this.backups.getById(tenantId, centralId, dto.sourceBackupId);
    if (!backup) {
      throw new NotFoundError(`Backup ${dto.sourceBackupId} not found for central ${centralId}`);
    }
    if (backup.status !== 'AVAILABLE') {
      throw new ValidationError(
        `Backup ${dto.sourceBackupId} is not restorable (status=${backup.status})`,
      );
    }

    const job = await this.jobs.create({
      tenantId,
      centralId,
      sourceBackupId: dto.sourceBackupId,
      dryRun: dto.dryRun,
      createdBy: userId ?? null,
    });

    const downloadUrl = await this.storage.getPresignedDownloadUrl({
      key: backup.storageKey,
      responseContentType: 'application/octet-stream',
      responseContentDisposition: `attachment; filename="central-${centralId}-${backup.id}.pgdump.custom"`,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });

    return {
      jobId: job.id,
      status: job.status,
      currentPhase: job.currentPhase,
      sourceBackupId: backup.id,
      downloadUrl,
      sha256: backup.sha256,
      byteSize: backup.byteSize,
      dryRun: job.dryRun,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    };
  }

  async getJob(tenantId: string, centralId: string, jobId: string) {
    const job = await this.jobs.getById(tenantId, centralId, jobId);
    if (!job) throw new NotFoundError(`Restore job ${jobId} not found for central ${centralId}`);
    return job;
  }

  async listJobs(tenantId: string, centralId: string) {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);
    return this.jobs.listByCentral(tenantId, centralId);
  }

  /**
   * Apply a progress report from the central: transition status/phase, append a
   * log line, and stamp completed_at on a terminal status. Rejects updates to an
   * already-finished job.
   */
  async updateProgress(
    tenantId: string,
    centralId: string,
    jobId: string,
    dto: UpdateRestoreProgressDTO,
  ) {
    const job = await this.jobs.getById(tenantId, centralId, jobId);
    if (!job) throw new NotFoundError(`Restore job ${jobId} not found for central ${centralId}`);
    if (TERMINAL_STATUSES.has(job.status)) {
      throw new ValidationError(`Restore job ${jobId} is already ${job.status}`);
    }

    const phase = dto.currentPhase ?? job.currentPhase;
    const log: RestoreLogEntry[] = [...(job.logEntries ?? [])];
    if (dto.message || dto.errorMessage) {
      log.push({
        ts: new Date().toISOString(),
        phase,
        level: dto.errorMessage ? 'ERROR' : 'INFO',
        message: dto.errorMessage ?? dto.message ?? '',
      });
    }

    const patch: UpdateRestoreJobPatch = { logEntries: log };
    if (dto.currentPhase) patch.currentPhase = dto.currentPhase;
    if (dto.errorMessage) patch.errorMessage = dto.errorMessage;
    if (dto.status) {
      patch.status = dto.status;
      if (TERMINAL_STATUSES.has(dto.status)) patch.completedAt = new Date();
    }

    const updated = await this.jobs.update(tenantId, jobId, patch);
    if (!updated) throw new NotFoundError(`Restore job ${jobId} not found`);
    return updated;
  }
}

export const centralRestoreService = new CentralRestoreService();
