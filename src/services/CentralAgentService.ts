import { s3Storage } from '../infrastructure/storage/S3Storage';
import { centralRestoreJobRepository } from '../repositories/CentralRestoreJobRepository';
import { centralBackupRepository } from '../repositories/CentralBackupRepository';
import { centralRestoreService, CentralRestoreService } from './CentralRestoreService';
import { NotFoundError } from '../shared/errors/AppError';
import { UpdateRestoreProgressDTO } from '../dto/request/CentralRestoreDTO';

const DOWNLOAD_URL_TTL_SECONDS = 3600; // 1 h — central downloads the dump

/** Identity of the authenticated central, supplied by centralAuthMiddleware. */
export interface CentralAgentContext {
  tenantId: string;
  centralId: string;
}

/** Shape returned to the central when it claims a job. */
export interface NextJobResult {
  jobId: string;
  type: 'restore';
  sourceBackupId: string;
  downloadUrl: string;
  phase: string;
}

// Structural deps for unit testing (mirrors CentralRestoreService DI).
type RestoreRepoDep = Pick<typeof centralRestoreJobRepository, 'claimNextQueued'>;
type BackupRepoDep = Pick<typeof centralBackupRepository, 'getById'>;
type StorageDep = Pick<typeof s3Storage, 'getPresignedDownloadUrl'>;
type RestoreServiceDep = Pick<CentralRestoreService, 'updateProgress'>;

/**
 * Central-agent brokerage for the field-swap restore poll loop. The central
 * polls `nextJob` to claim its next QUEUED restore (atomically marked RUNNING)
 * and a presigned download URL for the dump, then reports phase progress via
 * `reportProgress`. gcdr stays broker-only — it never runs pg_restore.
 *
 * Everything is scoped to the AUTHENTICATED central (ctx from
 * centralAuthMiddleware), so the central can only ever see/touch its own jobs.
 */
export class CentralAgentService {
  constructor(
    private readonly jobs: RestoreRepoDep = centralRestoreJobRepository,
    private readonly backups: BackupRepoDep = centralBackupRepository,
    private readonly storage: StorageDep = s3Storage,
    private readonly restore: RestoreServiceDep = centralRestoreService,
  ) {}

  /**
   * Claim the next QUEUED restore job for the authenticated central, atomically
   * transitioning it QUEUED -> RUNNING, and hand back a presigned download URL
   * for its source backup. Returns null when there is nothing to do (the route
   * maps that to 204).
   */
  async nextJob(ctx: CentralAgentContext): Promise<NextJobResult | null> {
    const job = await this.jobs.claimNextQueued(ctx.tenantId, ctx.centralId);
    if (!job) return null;

    const backup = await this.backups.getById(ctx.tenantId, ctx.centralId, job.sourceBackupId);
    if (!backup) {
      throw new NotFoundError(
        `Backup ${job.sourceBackupId} not found for central ${ctx.centralId}`,
      );
    }

    const downloadUrl = await this.storage.getPresignedDownloadUrl({
      key: backup.storageKey,
      responseContentType: 'application/octet-stream',
      responseContentDisposition: `attachment; filename="central-${ctx.centralId}-${backup.id}.pgdump.custom"`,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });

    return {
      jobId: job.id,
      type: 'restore',
      sourceBackupId: job.sourceBackupId,
      downloadUrl,
      phase: job.currentPhase,
    };
  }

  /**
   * Apply a progress report from the authenticated central. Scoped to the
   * central's id so it can only update its own jobs — delegates to the shared
   * CentralRestoreService.updateProgress (which validates job ownership +
   * terminal-status rules).
   */
  async reportProgress(
    ctx: CentralAgentContext,
    jobId: string,
    patch: UpdateRestoreProgressDTO,
  ) {
    return this.restore.updateProgress(ctx.tenantId, ctx.centralId, jobId, patch);
  }
}

export const centralAgentService = new CentralAgentService();
