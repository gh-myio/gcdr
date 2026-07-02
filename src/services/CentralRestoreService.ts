import {
  centralRestoreJobRepository,
  RestoreLogEntry,
  UpdateRestoreJobPatch,
} from '../repositories/CentralRestoreJobRepository';
import { centralBackupRepository } from '../repositories/CentralBackupRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';
import { StartRestoreDTO, UpdateRestoreProgressDTO } from '../dto/request/CentralRestoreDTO';
import { PaginatedResult } from '../shared/types';
import { CentralRestoreJob } from '../infrastructure/database/drizzle/db';

const TERMINAL_STATUSES = new Set(['DONE', 'FAILED', 'CANCELED']);

// CR-S6: phases advance in this fixed order — a progress report may stay on the
// same phase or move forward, but never regress. Status transitions out of a
// non-terminal state are constrained too (FAILED/CANCELED stay reachable from
// anywhere; DONE only from RUNNING and only once the phase is DONE).
const RESTORE_PHASE_ORDER = [
  'QUEUED',
  'DOWNLOAD',
  'VERIFY',
  'STOP_SERVICES',
  'RESTORE_DB',
  'START_SERVICES',
  'DONE',
];
const ALLOWED_STATUS_NEXT: Record<string, Set<string>> = {
  QUEUED: new Set(['QUEUED', 'RUNNING', 'FAILED', 'CANCELED']),
  RUNNING: new Set(['RUNNING', 'DONE', 'FAILED', 'CANCELED']),
};

// Structural deps for unit testing (mirrors CentralBackupService DI).
type RestoreRepoDep = Pick<
  typeof centralRestoreJobRepository,
  'create' | 'getById' | 'listByCentralPaged' | 'update' | 'findActiveByCentral'
>;

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
type BackupRepoDep = Pick<typeof centralBackupRepository, 'getById'>;
type CentralRepoDep = Pick<typeof centralRepository, 'getById'>;

/**
 * Restore brokerage for the field-swap. The replacement central adopts the same
 * serial+UUID, so a restore targets a central using one of ITS OWN backups.
 *
 * gcdr does NOT run pg_restore — it creates the job (QUEUED) and tracks the phase
 * progress the central reports (DOWNLOAD -> VERIFY -> STOP_SERVICES -> RESTORE_DB
 * -> START_SERVICES -> DONE). The central fetches the dump via its OWN presigned
 * URL from the agent poll (nextJob), so startRestore never mints one for the
 * browser (F-B3 boundary).
 */
export class CentralRestoreService {
  constructor(
    private readonly jobs: RestoreRepoDep = centralRestoreJobRepository,
    private readonly backups: BackupRepoDep = centralBackupRepository,
    private readonly centrals: CentralRepoDep = centralRepository,
  ) {}

  /**
   * Start a restore of `centralId` from one of its AVAILABLE backups. Returns the
   * job metadata only — NOT a presigned URL: the central fetches the dump via its
   * own agent poll (nextJob), so the browser never receives that capability.
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

    // Reject a second concurrent restore of the same central: an operator retry
    // (or double-submit) must not enqueue a second job that the central would run
    // back-to-back — two full pg_restores = double downtime on a production box.
    // A partial-unique index on non-terminal status is the race-proof backstop;
    // this pre-check turns the common sequential retry into a clean 409.
    const active = await this.jobs.findActiveByCentral(tenantId, centralId);
    if (active) {
      throw new ValidationError(
        `A restore is already in progress for central ${centralId} (job ${active.id}, status ${active.status})`,
      );
    }

    const job = await this.jobs.create({
      tenantId,
      centralId,
      sourceBackupId: dto.sourceBackupId,
      dryRun: dto.dryRun,
      createdBy: userId ?? null,
    });

    return {
      jobId: job.id,
      status: job.status,
      currentPhase: job.currentPhase,
      sourceBackupId: backup.id,
      sha256: backup.sha256,
      byteSize: backup.byteSize,
      dryRun: job.dryRun,
    };
  }

  async getJob(tenantId: string, centralId: string, jobId: string) {
    const job = await this.jobs.getById(tenantId, centralId, jobId);
    if (!job) throw new NotFoundError(`Restore job ${jobId} not found for central ${centralId}`);
    return job;
  }

  async listJobs(
    tenantId: string,
    centralId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<PaginatedResult<CentralRestoreJob>> {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
    const page = Math.max(1, opts.page ?? 1);
    const offset = (page - 1) * limit;

    const { items, total } = await this.jobs.listByCentralPaged(tenantId, centralId, {
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

    // CR-S6: reject illegal transitions before applying the patch. The central
    // drives this state machine, but must not jump statuses, regress a phase, or
    // report DONE without having reached the DONE phase.
    if (dto.status && !(ALLOWED_STATUS_NEXT[job.status] ?? new Set<string>()).has(dto.status)) {
      throw new ValidationError(`Invalid restore status transition: ${job.status} -> ${dto.status}`);
    }
    if (dto.currentPhase) {
      const from = RESTORE_PHASE_ORDER.indexOf(job.currentPhase);
      const to = RESTORE_PHASE_ORDER.indexOf(dto.currentPhase);
      if (to < from) {
        throw new ValidationError(
          `Restore phase cannot regress: ${job.currentPhase} -> ${dto.currentPhase}`,
        );
      }
    }
    if ((dto.status ?? job.status) === 'DONE' && (dto.currentPhase ?? job.currentPhase) !== 'DONE') {
      throw new ValidationError('Restore status DONE requires the DONE phase');
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

    // Compare-and-swap on the status we validated against: if a concurrent
    // terminal transition (e.g. the stall reaper marking this job FAILED) landed
    // between the read above and this write, the CAS misses and we reject the
    // report instead of resurrecting a reaped job with a stale-validated patch.
    const updated = await this.jobs.update(tenantId, jobId, patch, job.status);
    if (!updated) {
      throw new ValidationError(
        `Restore job ${jobId} changed concurrently (no longer ${job.status}); progress report rejected`,
      );
    }
    return updated;
  }

  /**
   * Operator-initiated cancel of a non-terminal restore. This is the ONLY
   * mutation the operator-facing PATCH route is allowed to make: phase/status
   * PROGRESS is reported by the central via /central-agent, so the operator can
   * never inject into the device state machine (round-3 #10). CAS-guarded so a
   * concurrent terminal transition wins.
   */
  async cancelRestore(
    tenantId: string,
    centralId: string,
    jobId: string,
    userId?: string,
  ) {
    const job = await this.jobs.getById(tenantId, centralId, jobId);
    if (!job) throw new NotFoundError(`Restore job ${jobId} not found for central ${centralId}`);
    if (TERMINAL_STATUSES.has(job.status)) {
      throw new ValidationError(`Restore job ${jobId} is already ${job.status}`);
    }

    const by = userId ? ` ${userId}` : '';
    const log: RestoreLogEntry[] = [
      ...(job.logEntries ?? []),
      {
        ts: new Date().toISOString(),
        phase: job.currentPhase,
        level: 'INFO',
        message: `restore canceled by operator${by}`,
      },
    ];

    const updated = await this.jobs.update(
      tenantId,
      jobId,
      { status: 'CANCELED', completedAt: new Date(), logEntries: log },
      job.status,
    );
    if (!updated) {
      throw new ValidationError(
        `Restore job ${jobId} changed concurrently (no longer ${job.status}); cancel rejected`,
      );
    }
    return updated;
  }
}

export const centralRestoreService = new CentralRestoreService();
