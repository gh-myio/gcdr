import { s3Storage } from '../infrastructure/storage/S3Storage';
import { centralRestoreJobRepository } from '../repositories/CentralRestoreJobRepository';
import { centralBackupRepository } from '../repositories/CentralBackupRepository';
import { centralRestoreService, CentralRestoreService } from './CentralRestoreService';
import { NotFoundError } from '../shared/errors/AppError';
import { UpdateRestoreProgressDTO } from '../dto/request/CentralRestoreDTO';
import { centralCommandRepository } from '../repositories/CentralCommandRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { centralCommandService, CentralCommandService } from './CentralCommandService';
import { UpdateCommandResultDTO, WifiPayloadDTO } from '../dto/request/CentralCommandDTO';

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

/** Shape returned to the central when it claims an operational command. */
export interface NextCommandResult {
  commandId: string;
  type: 'REBOOT' | 'RESTART_ERLANG' | 'RESTART_MYIOAPI' | 'SET_WIFI';
  // SET_WIFI carries { ssid, password, country } for the agent to apply via
  // myio-wifi-set; absent for the payload-less commands.
  payload?: WifiPayloadDTO | null;
}

// Structural deps for unit testing (mirrors CentralRestoreService DI).
type RestoreRepoDep = Pick<typeof centralRestoreJobRepository, 'claimNextQueued' | 'releaseClaim'>;
type BackupRepoDep = Pick<typeof centralBackupRepository, 'getById'>;
type StorageDep = Pick<typeof s3Storage, 'getPresignedDownloadUrl'>;
type RestoreServiceDep = Pick<CentralRestoreService, 'updateProgress'>;
type CommandRepoDep = Pick<typeof centralCommandRepository, 'claimNextQueued'>;
type CommandServiceDep = Pick<CentralCommandService, 'updateResult'>;
type CentralRepoDep = Pick<typeof centralRepository, 'recordPlatform'>;

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
    private readonly commands: CommandRepoDep = centralCommandRepository,
    private readonly commandService: CommandServiceDep = centralCommandService,
    private readonly centrals: CentralRepoDep = centralRepository,
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

    // The claim already moved the job QUEUED -> RUNNING. Any failure below (the
    // source backup vanished, the presign errored) would otherwise strand the
    // job RUNNING with no download URL ever delivered — invisible until the
    // ~20-min stall reaper fails it. Compensate by releasing the claim back to
    // QUEUED so the next poll re-claims it, then rethrow.
    try {
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
    } catch (err) {
      await this.jobs.releaseClaim(ctx.tenantId, job.id).catch(() => {
        /* best-effort compensation; the stall reaper is the backstop */
      });
      throw err;
    }
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

  /**
   * Claim the next QUEUED operational command for the authenticated central
   * (atomically QUEUED -> RUNNING). Returns null when there is nothing to do
   * (the route maps that to 204). The agent runs the command locally (reboot /
   * systemctl restart) and reports the result via reportCommandResult.
   */
  async nextCommand(ctx: CentralAgentContext): Promise<NextCommandResult | null> {
    const cmd = await this.commands.claimNextQueued(ctx.tenantId, ctx.centralId);
    if (!cmd) return null;
    return { commandId: cmd.id, type: cmd.type, payload: cmd.payload as WifiPayloadDTO | null };
  }

  /**
   * Best-effort capture of the central's hardware board, which its agent stamps
   * on every poll via the `x-device-type` header. Persisted to metadata.platform
   * so the operator UI and the SET_WIFI gate can tell CM4 from Orange Pi. Never
   * throws into the poll — a failed write just retries next tick.
   */
  async recordPlatform(ctx: CentralAgentContext, deviceType?: string): Promise<void> {
    if (!deviceType) return;
    await this.centrals.recordPlatform(ctx.tenantId, ctx.centralId, deviceType);
  }

  /**
   * Apply a command result from the authenticated central (exit_code + stdout/
   * stderr + status). Scoped to the central's id so it can only touch its own
   * commands — delegates to CentralCommandService.updateResult.
   */
  async reportCommandResult(
    ctx: CentralAgentContext,
    commandId: string,
    patch: UpdateCommandResultDTO,
  ) {
    return this.commandService.updateResult(ctx.tenantId, ctx.centralId, commandId, patch);
  }
}

export const centralAgentService = new CentralAgentService();
