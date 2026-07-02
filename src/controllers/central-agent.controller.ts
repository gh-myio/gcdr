import { Router, Request, Response, NextFunction } from 'express';
import { centralAgentService } from '../services/CentralAgentService';
import { centralEnrollmentService } from '../services/CentralEnrollmentService';
import { UpdateRestoreProgressSchema } from '../dto/request/CentralRestoreDTO';
import { UpdateCommandResultSchema } from '../dto/request/CentralCommandDTO';
import { EnrollCentralSchema } from '../dto/request/CentralEnrollDTO';
import { sendSuccess, sendNoContent } from '../middleware';
import { UnauthorizedError, ValidationError } from '../shared/errors/AppError';

// =============================================================================
// Central-agent API (field-swap restore poll loop). Mounted at
// /api/v1/central-agent behind centralAuthMiddleware, which authenticates the
// device via its agent_secret-signed JWT and sets req.centralContext.
//
// gcdr is broker-only: it hands out the job + presigned download URL and tracks
// the phase progress the central reports. It never runs pg_restore itself.
// =============================================================================

const router = Router();

const ERR_JOB_ID_REQUIRED = 'Job ID is required';

/** Pull the authenticated central identity off the request (set by the gate). */
function requireCentral(req: Request): { tenantId: string; centralId: string } {
  const central = req.centralContext;
  if (!central) {
    // Should never happen behind centralAuthMiddleware, but fail closed.
    throw new UnauthorizedError('Central não autenticada');
  }
  return central;
}

/**
 * GET /central-agent/jobs/next
 * Claim the next QUEUED restore job for the authenticated central (atomically
 * transitioned QUEUED -> RUNNING) + a presigned download URL for the dump.
 * Returns 204 No Content when there is nothing to do.
 */
router.get('/jobs/next', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = requireCentral(req);
    const job = await centralAgentService.nextJob(ctx);
    if (!job) {
      sendNoContent(res);
      return;
    }
    sendSuccess(res, job, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /central-agent/restore/:jobId
 * Progress report from the authenticated central as it runs the restore
 * (download -> verify -> stop services -> pg_restore -> start services).
 * Scoped to the central — it can only touch its own jobs.
 */
router.patch('/restore/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = requireCentral(req);
    const { jobId } = req.params;
    if (!jobId) {
      throw new ValidationError(ERR_JOB_ID_REQUIRED);
    }
    const dto = UpdateRestoreProgressSchema.parse(req.body);
    const result = await centralAgentService.reportProgress(ctx, jobId, dto);
    sendSuccess(res, result, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /central-agent/commands/next
 * Claim the next QUEUED operational command for the authenticated central
 * (atomically QUEUED -> RUNNING). Returns 204 No Content when there is nothing
 * to do. The agent runs it locally (reboot / systemctl restart myio) and reports
 * the result via PATCH /central-agent/commands/:commandId.
 */
router.get('/commands/next', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = requireCentral(req);
    const cmd = await centralAgentService.nextCommand(ctx);
    if (!cmd) {
      sendNoContent(res);
      return;
    }
    sendSuccess(res, cmd, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /central-agent/commands/:commandId
 * Result report from the authenticated central after it ran the command
 * (exit_code + stdout + stderr + status). Scoped to the central — it can only
 * touch its own commands.
 */
router.patch('/commands/:commandId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = requireCentral(req);
    const { commandId } = req.params;
    if (!commandId) {
      throw new ValidationError('Command ID is required');
    }
    const dto = UpdateCommandResultSchema.parse(req.body);
    const result = await centralAgentService.reportCommandResult(ctx, commandId, dto);
    sendSuccess(res, result, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;

/**
 * POST /central-agent/enroll   (zero-touch provisioning — Slice 1.5)
 *
 * Device-facing and deliberately UNAUTHENTICATED by centralAuthMiddleware: the
 * central has no agent_secret yet, so the one-time enroll token IS the
 * credential. Mounted in app.ts as its own route BEFORE the centralAuthMiddleware
 * /central-agent mount, so it bypasses that gate.
 *
 * Body: { uuid, enrollToken }. On success returns { agentSecret } (returned
 * once); the central then signs its poll-loop JWT (HS256) with that secret. The
 * enroll token is single-use — it is cleared on success.
 */
export const enrollHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { uuid, enrollToken } = EnrollCentralSchema.parse(req.body);
    const result = await centralEnrollmentService.enroll(uuid, enrollToken);
    sendSuccess(res, result, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
};
