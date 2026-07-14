import { eq, and, desc, lt, inArray, sql } from 'drizzle-orm';
import { db, schema, CentralCommand } from '../infrastructure/database/drizzle/db';
import { generateId } from '../shared/utils/idGenerator';
import { now } from '../shared/utils/dateUtils';
import { WifiPayloadDTO } from '../dto/request/CentralCommandDTO';

const { centralCommands } = schema;

export type CommandType = 'REBOOT' | 'RESTART_ERLANG' | 'RESTART_MYIOAPI' | 'SET_WIFI';
export type CommandStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export interface CreateCommandInput {
  id?: string;
  tenantId: string;
  centralId: string;
  type: CommandType;
  // SET_WIFI carries { ssid, password, country }; null for payload-less commands.
  payload?: unknown;
  createdBy?: string | null;
}

export interface UpdateCommandPatch {
  status?: CommandStatus;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  errorMessage?: string | null;
  claimedAt?: Date | null;
  completedAt?: Date | null;
  // Set to null on a terminal transition to purge the consumed SET_WIFI secret.
  payload?: WifiPayloadDTO | null;
}

/**
 * Persistence for `central_commands`. Same shape as CentralRestoreJobRepository:
 * gcdr only tracks the state machine; the central runs the command and reports
 * the result. Tenant-scoped.
 */
export class CentralCommandRepository {
  async create(input: CreateCommandInput): Promise<CentralCommand> {
    const id = input.id || generateId();
    const ts = new Date(now());

    const [row] = await db
      .insert(centralCommands)
      .values({
        id,
        tenantId: input.tenantId,
        centralId: input.centralId,
        type: input.type,
        payload: input.payload ?? null,
        status: 'QUEUED',
        createdAt: ts,
        updatedAt: ts,
        createdBy: input.createdBy ?? null,
      })
      .returning();

    return row;
  }

  async getById(tenantId: string, centralId: string, id: string): Promise<CentralCommand | null> {
    const [row] = await db
      .select()
      .from(centralCommands)
      .where(
        and(
          eq(centralCommands.tenantId, tenantId),
          eq(centralCommands.centralId, centralId),
          eq(centralCommands.id, id),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async listByCentral(tenantId: string, centralId: string, limit = 50): Promise<CentralCommand[]> {
    return db
      .select()
      .from(centralCommands)
      .where(and(eq(centralCommands.tenantId, tenantId), eq(centralCommands.centralId, centralId)))
      .orderBy(desc(centralCommands.createdAt))
      .limit(limit);
  }

  /**
   * Paginated list (newest first) + total count → the API returns the project's
   * PaginatedResult instead of a bare array with a hidden cap.
   */
  async listByCentralPaged(
    tenantId: string,
    centralId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: CentralCommand[]; total: number }> {
    const where = and(
      eq(centralCommands.tenantId, tenantId),
      eq(centralCommands.centralId, centralId),
    );
    const items = await db
      .select()
      .from(centralCommands)
      .where(where)
      .orderBy(desc(centralCommands.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(centralCommands)
      .where(where);
    return { items, total: Number(count) };
  }

  /**
   * The current non-terminal command for a central (QUEUED or RUNNING), if any.
   * Used to reject enqueuing a second command while one is still in flight — an
   * operator (or double-submit) must not queue several REBOOTs the central would
   * run back-to-back.
   */
  async findActiveByCentral(
    tenantId: string,
    centralId: string,
  ): Promise<CentralCommand | null> {
    const [row] = await db
      .select()
      .from(centralCommands)
      .where(
        and(
          eq(centralCommands.tenantId, tenantId),
          eq(centralCommands.centralId, centralId),
          inArray(centralCommands.status, ['QUEUED', 'RUNNING']),
        ),
      )
      .orderBy(desc(centralCommands.createdAt))
      .limit(1);

    return row ?? null;
  }

  /**
   * Atomically claim the oldest QUEUED command for `centralId` (QUEUED ->
   * RUNNING) in a single statement, used by the central-agent poll loop
   * (GET /central-agent/commands/next). `FOR UPDATE SKIP LOCKED` makes concurrent
   * polls hand out distinct commands (or none) instead of blocking.
   */
  claimNextQueuedQuery(tenantId: string, centralId: string) {
    const ts = new Date(now());
    return db
      .update(centralCommands)
      .set({ status: 'RUNNING', claimedAt: ts, updatedAt: ts })
      .where(
        eq(
          centralCommands.id,
          sql`(
            SELECT ${centralCommands.id}
            FROM ${centralCommands}
            WHERE ${centralCommands.tenantId} = ${tenantId}
              AND ${centralCommands.centralId} = ${centralId}
              AND ${centralCommands.status} = 'QUEUED'
            ORDER BY ${centralCommands.createdAt} ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )`,
        ),
      )
      .returning();
  }

  async claimNextQueued(tenantId: string, centralId: string): Promise<CentralCommand | null> {
    const [row] = await this.claimNextQueuedQuery(tenantId, centralId);
    return row ?? null;
  }

  /**
   * Patch a command. When `expectedStatus` is given the write is a compare-and-
   * swap (`... AND status = expectedStatus`), so a concurrent terminal transition
   * (e.g. the reaper failing the command between a caller's read and this write)
   * makes the update a no-op and returns null instead of resurrecting it with a
   * stale-validated patch.
   */
  async update(
    tenantId: string,
    id: string,
    patch: UpdateCommandPatch,
    expectedStatus?: CommandStatus,
  ): Promise<CentralCommand | null> {
    const ts = new Date(now());

    const predicates = [eq(centralCommands.tenantId, tenantId), eq(centralCommands.id, id)];
    if (expectedStatus) predicates.push(eq(centralCommands.status, expectedStatus));

    const [row] = await db
      .update(centralCommands)
      .set({ ...patch, updatedAt: ts })
      .where(and(...predicates))
      .returning();

    return row ?? null;
  }

  /**
   * Visibility-timeout sweep for stalled commands — both ways a central can go
   * away:
   *   - RUNNING whose central died mid-command and stopped reporting;
   *   - QUEUED that an offline central never claimed. Left forever, that orphan
   *     makes findActiveByCentral reject every new command (including a REBOOT),
   *     and its SET_WIFI password lingers with it.
   * Fail rows in either state not updated within `olderThanMs`, and null the
   * payload so no consumed/abandoned WiFi secret is retained.
   */
  reapStalledJobsQuery(cutoff: Date) {
    return db
      .update(centralCommands)
      .set({
        status: 'FAILED',
        errorMessage:
          'command timed out: the central did not claim or report it within the stall window',
        payload: null,
        updatedAt: new Date(now()),
      })
      .where(
        and(
          inArray(centralCommands.status, ['QUEUED', 'RUNNING']),
          lt(centralCommands.updatedAt, cutoff),
        ),
      )
      .returning({ id: centralCommands.id, centralId: centralCommands.centralId });
  }

  async reapStalledJobs(olderThanMs: number): Promise<{ id: string; centralId: string }[]> {
    const cutoff = new Date(new Date(now()).getTime() - olderThanMs);
    return this.reapStalledJobsQuery(cutoff);
  }
}

export const centralCommandRepository = new CentralCommandRepository();
