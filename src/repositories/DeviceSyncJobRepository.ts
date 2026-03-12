import { db } from '../infrastructure/database/drizzle/db';
import { deviceSyncJobs } from '../infrastructure/database/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'PARTIAL' | 'FAILED';
export type JobPhase  = 'QUEUED' | 'CHECK' | 'ACTION_PLAN' | 'DETECT_RELOCATIONS' | 'RELOCATE' | 'APPLY_UPDATES' | 'CONSOLIDATE_CREATES' | 'DONE';
export type LogLevel  = 'INFO' | 'WARN' | 'OK' | 'FAIL' | 'ERROR';

export interface JobLogEntry {
  ts:      string;
  phase:   JobPhase;
  level:   LogLevel;
  message: string;
}

export interface JobPhasesSummary {
  check?:              { conformant: number; divergent: number; notLinked: number };
  actionPlan?:         { create: number; update: number; updateIdentifier: number; skip: number };
  detectRelocations?:  { relocate: number; genuineCreates: number };
  relocate?:           { ok: number; fail: number };
  applyUpdates?:       { ok: number; fail: number };
  consolidateCreates?: { ok: number; fail: number };
}

export interface DeviceSyncJob {
  id:           string;
  tenantId:     string;
  customerId:   string;
  status:       JobStatus;
  currentPhase: JobPhase;
  dryRun:       boolean;
  inputConfig:  { defaultAssetId?: string };
  inputFiles:   Array<{ name: string; content: string }>;
  phasesSummary: JobPhasesSummary;
  logEntries:   JobLogEntry[];
  errorMessage: string | null;
  createdAt:    Date;
  updatedAt:    Date;
  completedAt:  Date | null;
}

export interface CreateJobData {
  tenantId:    string;
  customerId:  string;
  dryRun:      boolean;
  inputConfig: { defaultAssetId?: string };
  inputFiles:  Array<{ name: string; content: string }>;
}

export interface UpdateJobData {
  status?:       JobStatus;
  currentPhase?: JobPhase;
  phasesSummary?: JobPhasesSummary;
  logEntries?:   JobLogEntry[];
  errorMessage?: string | null;
  completedAt?:  Date | null;
  updatedAt?:    Date;
}

export interface ListJobsParams {
  customerId?: string;
  status?:     JobStatus;
  page?:       number;
  pageSize?:   number;
}

export class DeviceSyncJobRepository {
  async create(data: CreateJobData): Promise<DeviceSyncJob> {
    const [row] = await db.insert(deviceSyncJobs).values({
      tenantId:     data.tenantId,
      customerId:   data.customerId,
      dryRun:       data.dryRun,
      inputConfig:  data.inputConfig,
      inputFiles:   data.inputFiles as never,
      phasesSummary: {} as never,
      logEntries:   [] as never,
    }).returning();

    return this.mapRow(row);
  }

  async findById(tenantId: string, jobId: string): Promise<DeviceSyncJob | null> {
    const [row] = await db
      .select()
      .from(deviceSyncJobs)
      .where(and(eq(deviceSyncJobs.tenantId, tenantId), eq(deviceSyncJobs.id, jobId)))
      .limit(1);

    return row ? this.mapRow(row) : null;
  }

  async update(tenantId: string, jobId: string, data: UpdateJobData): Promise<void> {
    const updateData: Record<string, unknown> = { updatedAt: data.updatedAt ?? new Date() };

    if (data.status       !== undefined) updateData.status       = data.status;
    if (data.currentPhase !== undefined) updateData.currentPhase = data.currentPhase;
    if (data.phasesSummary !== undefined) updateData.phasesSummary = data.phasesSummary;
    if (data.logEntries   !== undefined) updateData.logEntries   = data.logEntries;
    if (data.errorMessage !== undefined) updateData.errorMessage = data.errorMessage;
    if (data.completedAt  !== undefined) updateData.completedAt  = data.completedAt;

    await db
      .update(deviceSyncJobs)
      .set(updateData)
      .where(and(eq(deviceSyncJobs.tenantId, tenantId), eq(deviceSyncJobs.id, jobId)));
  }

  async list(tenantId: string, params: ListJobsParams): Promise<{ items: DeviceSyncJob[]; total: number }> {
    const page     = Math.max(1, params.page     ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset   = (page - 1) * pageSize;

    const conditions = [eq(deviceSyncJobs.tenantId, tenantId)];
    if (params.customerId) conditions.push(eq(deviceSyncJobs.customerId, params.customerId));
    if (params.status)     conditions.push(eq(deviceSyncJobs.status,     params.status));

    const whereClause = and(...conditions);

    const [rows, countRows] = await Promise.all([
      db.select()
        .from(deviceSyncJobs)
        .where(whereClause)
        .orderBy(desc(deviceSyncJobs.createdAt))
        .limit(pageSize)
        .offset(offset),
      db.select({ count: deviceSyncJobs.id })
        .from(deviceSyncJobs)
        .where(whereClause),
    ]);

    return { items: rows.map(this.mapRow), total: countRows.length };
  }

  private mapRow(row: typeof deviceSyncJobs.$inferSelect): DeviceSyncJob {
    return {
      id:           row.id,
      tenantId:     row.tenantId,
      customerId:   row.customerId,
      status:       row.status       as JobStatus,
      currentPhase: row.currentPhase as JobPhase,
      dryRun:       row.dryRun,
      inputConfig:  (row.inputConfig  as { defaultAssetId?: string }) ?? {},
      inputFiles:   (row.inputFiles   as Array<{ name: string; content: string }>) ?? [],
      phasesSummary: (row.phasesSummary as JobPhasesSummary) ?? {},
      logEntries:   (row.logEntries   as JobLogEntry[]) ?? [],
      errorMessage: row.errorMessage  ?? null,
      createdAt:    row.createdAt,
      updatedAt:    row.updatedAt,
      completedAt:  row.completedAt   ?? null,
    };
  }
}

export const deviceSyncJobRepository = new DeviceSyncJobRepository();
