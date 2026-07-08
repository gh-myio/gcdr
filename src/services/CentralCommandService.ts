import {
  centralCommandRepository,
  UpdateCommandPatch,
} from '../repositories/CentralCommandRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';
import { CreateCommandDTO, UpdateCommandResultDTO } from '../dto/request/CentralCommandDTO';
import { PaginatedResult } from '../shared/types';
import { CentralCommand } from '../infrastructure/database/drizzle/db';

const TERMINAL_STATUSES = new Set(['DONE', 'FAILED']);

// The SET_WIFI payload carries the WiFi password; it is written for the central
// to consume and must never be echoed back to an operator. Strip it from every
// operator-facing return (the central-agent path returns the payload separately).
function stripPayload<T extends { payload?: unknown }>(cmd: T): Omit<T, 'payload'> {
  const { payload: _payload, ...rest } = cmd;
  return rest;
}

// Status may advance QUEUED -> RUNNING -> DONE/FAILED. FAILED is reachable from
// any non-terminal state; DONE only from RUNNING (the central always claims a
// command — QUEUED -> RUNNING — before it can report a result, so a direct
// QUEUED -> DONE never happens and is not allowed).
const ALLOWED_STATUS_NEXT: Record<string, Set<string>> = {
  QUEUED: new Set(['QUEUED', 'RUNNING', 'FAILED']),
  RUNNING: new Set(['RUNNING', 'DONE', 'FAILED']),
};

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

// Structural deps for unit testing (mirrors CentralRestoreService DI).
type CommandRepoDep = Pick<
  typeof centralCommandRepository,
  'create' | 'getById' | 'listByCentralPaged' | 'update' | 'findActiveByCentral'
>;
type CentralRepoDep = Pick<typeof centralRepository, 'getById'>;

/**
 * Operational commands for a central (reboot the box, restart the erlang/
 * myio-core service). Same broker model as restore: gcdr creates the command
 * (QUEUED); the central's myio-gcdr-agent claims it, runs it, and reports the
 * result (exit_code + stdout + stderr). gcdr never reaches the central directly.
 */
export class CentralCommandService {
  constructor(
    private readonly commands: CommandRepoDep = centralCommandRepository,
    private readonly centrals: CentralRepoDep = centralRepository,
  ) {}

  /** Operator enqueues a command for the central. */
  async createCommand(
    tenantId: string,
    centralId: string,
    userId: string | undefined,
    dto: CreateCommandDTO,
  ) {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    // CM4-only: SET_WIFI configures wpa_supplicant, which only the CM4 image
    // ships (the OPi fleet has no myio-wifi-set). Gate on the board the central
    // reports via its agent poll (metadata.platform). The UI hides the button
    // too; this is the server-side backstop.
    if (dto.type === 'SET_WIFI') {
      const platform = String(
        (central.metadata as Record<string, unknown> | undefined)?.platform ?? '',
      );
      if (!/cm4/i.test(platform)) {
        throw new ValidationError('SET_WIFI is only supported on CM4 centrals');
      }
    }

    // Dedup guard: reject a second command while one is still in flight. Without
    // this a double-submit (or two operators) could enqueue several REBOOTs the
    // central would run back-to-back — reboot, come back, reboot again.
    const active = await this.commands.findActiveByCentral(tenantId, centralId);
    if (active) {
      throw new ValidationError(
        `Central ${centralId} already has a pending command (${active.type}, ${active.status}); ` +
          'wait for it to finish before sending another',
      );
    }

    const created = await this.commands.create({
      tenantId,
      centralId,
      type: dto.type,
      payload: dto.payload,
      createdBy: userId ?? null,
    });
    return stripPayload(created);
  }

  async listCommands(
    tenantId: string,
    centralId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<PaginatedResult<Omit<CentralCommand, 'payload'>>> {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);

    const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
    const page = Math.max(1, opts.page ?? 1);
    const offset = (page - 1) * limit;

    const { items, total } = await this.commands.listByCentralPaged(tenantId, centralId, {
      limit,
      offset,
    });
    return {
      items: items.map(stripPayload),
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + items.length < total,
      },
    };
  }

  async getCommand(tenantId: string, centralId: string, commandId: string) {
    const cmd = await this.commands.getById(tenantId, centralId, commandId);
    if (!cmd) throw new NotFoundError(`Command ${commandId} not found for central ${centralId}`);
    return stripPayload(cmd);
  }

  /**
   * Apply the result the central reported: transition status, store exit_code +
   * stdout/stderr, stamp completed_at on a terminal status. Rejects updates to an
   * already-finished command and illegal status transitions.
   */
  async updateResult(
    tenantId: string,
    centralId: string,
    commandId: string,
    dto: UpdateCommandResultDTO,
  ) {
    const cmd = await this.commands.getById(tenantId, centralId, commandId);
    if (!cmd) throw new NotFoundError(`Command ${commandId} not found for central ${centralId}`);
    if (TERMINAL_STATUSES.has(cmd.status)) {
      throw new ValidationError(`Command ${commandId} is already ${cmd.status}`);
    }
    if (dto.status && !(ALLOWED_STATUS_NEXT[cmd.status] ?? new Set<string>()).has(dto.status)) {
      throw new ValidationError(`Invalid command status transition: ${cmd.status} -> ${dto.status}`);
    }

    const patch: UpdateCommandPatch = {};
    if (dto.status) {
      patch.status = dto.status;
      if (TERMINAL_STATUSES.has(dto.status)) patch.completedAt = new Date();
    }
    if (dto.exitCode !== undefined) patch.exitCode = dto.exitCode;
    if (dto.stdout !== undefined) patch.stdout = dto.stdout;
    if (dto.stderr !== undefined) patch.stderr = dto.stderr;
    if (dto.errorMessage !== undefined) patch.errorMessage = dto.errorMessage;

    // Compare-and-swap on the status we validated against: if the reaper (or any
    // concurrent terminal transition) changed the command between the read above
    // and this write, the CAS misses and we reject the report instead of
    // resurrecting a reaped command with a stale-validated patch.
    const updated = await this.commands.update(tenantId, commandId, patch, cmd.status);
    if (!updated) {
      throw new ValidationError(
        `Command ${commandId} changed concurrently (no longer ${cmd.status}); result report rejected`,
      );
    }
    return updated;
  }
}

export const centralCommandService = new CentralCommandService();
