import { eq, and, desc, sql } from 'drizzle-orm';
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
        version: 1,
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

  async update(
    tenantId: string,
    id: string,
    patch: UpdateRestoreJobPatch,
  ): Promise<CentralRestoreJob | null> {
    const ts = new Date(now());

    const [row] = await db
      .update(centralRestoreJobs)
      .set({ ...patch, updatedAt: ts, version: sql`${centralRestoreJobs.version} + 1` })
      .where(and(eq(centralRestoreJobs.tenantId, tenantId), eq(centralRestoreJobs.id, id)))
      .returning();

    return row ?? null;
  }
}

export const centralRestoreJobRepository = new CentralRestoreJobRepository();
