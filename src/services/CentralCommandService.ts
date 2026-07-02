import {
  centralCommandRepository,
  UpdateCommandPatch,
} from '../repositories/CentralCommandRepository';
import { centralRepository } from '../repositories/CentralRepository';
import { NotFoundError, ValidationError } from '../shared/errors/AppError';
import { CreateCommandDTO, UpdateCommandResultDTO } from '../dto/request/CentralCommandDTO';

const TERMINAL_STATUSES = new Set(['DONE', 'FAILED']);

// Status may advance QUEUED -> RUNNING -> DONE/FAILED. FAILED is reachable from
// anywhere non-terminal; DONE only from RUNNING (the central ran the command).
const ALLOWED_STATUS_NEXT: Record<string, Set<string>> = {
  QUEUED: new Set(['QUEUED', 'RUNNING', 'DONE', 'FAILED']),
  RUNNING: new Set(['RUNNING', 'DONE', 'FAILED']),
};

// Structural deps for unit testing (mirrors CentralRestoreService DI).
type CommandRepoDep = Pick<
  typeof centralCommandRepository,
  'create' | 'getById' | 'listByCentral' | 'update'
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

    return this.commands.create({
      tenantId,
      centralId,
      type: dto.type,
      createdBy: userId ?? null,
    });
  }

  async listCommands(tenantId: string, centralId: string) {
    const central = await this.centrals.getById(tenantId, centralId);
    if (!central) throw new NotFoundError(`Central ${centralId} not found`);
    return this.commands.listByCentral(tenantId, centralId);
  }

  async getCommand(tenantId: string, centralId: string, commandId: string) {
    const cmd = await this.commands.getById(tenantId, centralId, commandId);
    if (!cmd) throw new NotFoundError(`Command ${commandId} not found for central ${centralId}`);
    return cmd;
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

    const updated = await this.commands.update(tenantId, commandId, patch);
    if (!updated) throw new NotFoundError(`Command ${commandId} not found`);
    return updated;
  }
}

export const centralCommandService = new CentralCommandService();
