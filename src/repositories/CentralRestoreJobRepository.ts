import { eq, and, desc, lt, inArray, sql } from 'drizzle-orm';
import { db, schema, CentralRestoreJob } from '../infrastructure/database/drizzle/db';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';

const { centralRestoreJobs } = schema;

export type RestoreLogEntry = { ts: string; phase: string; level: string; message: string };

export type RestoreJobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED';
export type RestoreJobPhase =
  | 'QUEUED'
  | 'DOWNLOAD'
  | 'VERIFY'
  | 'STOP_SERVICES'
  | 'RESTORE_DB'
  | 'START_SERVICES'
  | 'DONE';

export interface CreateRestoreJobInput {
  id?: string;
  tenantId: string;
  centralId: string;
  sourceBackupId: string;
  dryRun?: boolean;
  createdBy?: string | null;
}

export interface UpdateRestoreJobPatch {
  status?: RestoreJobStatus;
  currentPhase?: RestoreJobPhase;
  logEntries?: RestoreLogEntry[];
  errorMessage?: string | null;
  completedAt?: Date | null;
}

/**
 * Persistence for `central_restore_jobs`. gcdr only tracks the state machine;
 * the central runs the actual pg_restore and reports progress. Tenant-scoped.
 */
export class CentralRestoreJobRepository {
  async create(input: CreateRestoreJobInput): Promise<CentralRestoreJob> {
    const id = input.id || generateId();
    const ts = new Date(now());

    const [row] = await db
      .insert(centralRestoreJobs)
      .values({
        id,
        tenantId: input.tenantId,
        centralId: input.centralId,
        sourceBackupId: input.sourceBackupId,
        status: 'QUEUED',
        currentPhase: 'QUEUED',
        dryRun: input.dryRun ?? false,
        logEntries: [],
        createdAt: ts,
        updatedAt: ts,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    return row;
  }

  async getById(tenantId: string, centralId: string, id: string): Promise<CentralRestoreJob | null> {
    const [row] = await db
      .select()
      .from(centralRestoreJobs)
      .where(
        and(
          eq(centralRestoreJobs.tenantId, tenantId),
          eq(centralRestoreJobs.centralId, centralId),
          eq(centralRestoreJobs.id, id),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async listByCentral(
    tenantId: string,
    centralId: string,
    limit = 50,
  ): Promise<CentralRestoreJob[]> {
    return db
      .select()
      .from(centralRestoreJobs)
      .where(
        and(eq(centralRestoreJobs.tenantId, tenantId), eq(centralRestoreJobs.centralId, centralId)),
      )
      .orderBy(desc(centralRestoreJobs.createdAt))
      .limit(limit);
  }

  /**
   * Paginated list (newest first) + total count, so the API returns the
   * project's PaginatedResult instead of a bare array with a hidden cap
   * (round-3 #12).
   */
  async listByCentralPaged(
    tenantId: string,
    centralId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: CentralRestoreJob[]; total: number }> {
    const where = and(
      eq(centralRestoreJobs.tenantId, tenantId),
      eq(centralRestoreJobs.centralId, centralId),
    );
    const items = await db
      .select()
      .from(centralRestoreJobs)
      .where(where)
      .orderBy(desc(centralRestoreJobs.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(centralRestoreJobs)
      .where(where);
    return { items, total: Number(count) };
  }

  /**
   * Atomically claim the oldest QUEUED job for `centralId` and transition it
   * QUEUED -> RUNNING in a single statement. Used by the
   * central-agent poll loop (GET /central-agent/jobs/next). `FOR UPDATE SKIP
   * LOCKED` on the inner select makes concurrent polls hand out distinct jobs
   * (or none) instead of blocking. Returns the claimed row, or null if the
   * central has no QUEUED job.
   */
  claimNextQueuedQuery(tenantId: string, centralId: string) {
    const ts = new Date(now());
    return db
      .update(centralRestoreJobs)
      .set({
        status: 'RUNNING',
        updatedAt: ts,
      })
      .where(
        eq(
          centralRestoreJobs.id,
          sql`(
            SELECT ${centralRestoreJobs.id}
            FROM ${centralRestoreJobs}
            WHERE ${centralRestoreJobs.tenantId} = ${tenantId}
              AND ${centralRestoreJobs.centralId} = ${centralId}
              AND ${centralRestoreJobs.status} = 'QUEUED'
            ORDER BY ${centralRestoreJobs.createdAt} ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )`,
        ),
      )
      .returning();
  }

  async claimNextQueued(
    tenantId: string,
    centralId: string,
  ): Promise<CentralRestoreJob | null> {
    const [row] = await this.claimNextQueuedQuery(tenantId, centralId);
    return row ?? null;
  }

  /**
   * Release a job we just claimed back to QUEUED — compensation for a
   * `nextJob`/poll that atomically claimed the job (QUEUED -> RUNNING) but then
   * failed to hand the central a usable job (missing backup / presign error).
   * CAS on `status = 'RUNNING'` so we only revert our own fresh claim and never
   * clobber a terminal status set concurrently (e.g. by the stall reaper).
   */
  async releaseClaim(tenantId: string, id: string): Promise<void> {
    const ts = new Date(now());
    await db
      .update(centralRestoreJobs)
      .set({ status: 'QUEUED', currentPhase: 'QUEUED', updatedAt: ts })
      .where(
        and(
          eq(centralRestoreJobs.tenantId, tenantId),
          eq(centralRestoreJobs.id, id),
          eq(centralRestoreJobs.status, 'RUNNING'),
        ),
      );
  }

  /**
   * The current non-terminal restore job for a central (QUEUED or RUNNING), if
   * any. Used to reject starting a second concurrent restore of the same central
   * — a partial-unique index enforces this at the DB level, this is the friendly
   * pre-check that turns the race into a clean 409.
   */
  async findActiveByCentral(
    tenantId: string,
    centralId: string,
  ): Promise<CentralRestoreJob | null> {
    const [row] = await db
      .select()
      .from(centralRestoreJobs)
      .where(
        and(
          eq(centralRestoreJobs.tenantId, tenantId),
          eq(centralRestoreJobs.centralId, centralId),
          inArray(centralRestoreJobs.status, ['QUEUED', 'RUNNING']),
        ),
      )
      .orderBy(desc(centralRestoreJobs.createdAt))
      .limit(1);

    return row ?? null;
  }

  /**
   * Patch a job. When `expectedStatus` is given the write is a compare-and-swap
   * (`... AND status = expectedStatus`), so a concurrent terminal transition
   * (e.g. the reaper marking the job FAILED between a caller's read and this
   * write) makes the update a no-op and returns null instead of resurrecting the
   * job with a stale-validated patch.
   */
  async update(
    tenantId: string,
    id: string,
    patch: UpdateRestoreJobPatch,
    expectedStatus?: RestoreJobStatus,
  ): Promise<CentralRestoreJob | null> {
    const ts = new Date(now());

    const predicates = [eq(centralRestoreJobs.tenantId, tenantId), eq(centralRestoreJobs.id, id)];
    if (expectedStatus) predicates.push(eq(centralRestoreJobs.status, expectedStatus));

    const [row] = await db
      .update(centralRestoreJobs)
      .set({ ...patch, updatedAt: ts })
      .where(and(...predicates))
      .returning();

    return row ?? null;
  }

  /**
   * CR-S5 visibility-timeout: a RUNNING job whose central died mid-restore stops
   * reporting, so updated_at goes stale while status stays RUNNING forever. This
   * sweeps cross-tenant for RUNNING jobs not updated within `olderThanMs` and
   * fails them (a partial pg_restore is NOT safe to auto-requeue), surfacing the
   * stall for alerting/operator action. Returns the reaped job ids.
   */
  reapStalledJobsQuery(cutoff: Date) {
    return db
      .update(centralRestoreJobs)
      .set({
        status: 'FAILED',
        errorMessage:
          'restore timed out: no progress within the stall window (central likely died mid-restore)',
        updatedAt: new Date(now()),
      })
      .where(and(eq(centralRestoreJobs.status, 'RUNNING'), lt(centralRestoreJobs.updatedAt, cutoff)))
      .returning({ id: centralRestoreJobs.id, centralId: centralRestoreJobs.centralId });
  }

  async reapStalledJobs(olderThanMs: number): Promise<{ id: string; centralId: string }[]> {
    const cutoff = new Date(new Date(now()).getTime() - olderThanMs);
    return this.reapStalledJobsQuery(cutoff);
  }
}

export const centralRestoreJobRepository = new CentralRestoreJobRepository();
