import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { deviceSyncJobService } from '../services/DeviceSyncJobService';
import { sendSuccess } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';
import { JobStatus } from '../repositories/DeviceSyncJobRepository';

const router = Router();

// ============================================================
// Zod schemas
// ============================================================

const CreateJobSchema = z.object({
  customerId:     z.string().uuid(),
  defaultAssetId: z.string().uuid().optional(),
  dryRun:         z.boolean().optional().default(false),
  files: z.array(z.object({
    name:    z.string().min(1).max(255),
    content: z.string().min(1).max(512_000), // ~500 KB
  })).min(1).max(20),
});

const ListJobsQuerySchema = z.object({
  customerId: z.string().uuid().optional(),
  status:     z.enum(['QUEUED', 'RUNNING', 'DONE', 'PARTIAL', 'FAILED']).optional(),
  page:       z.coerce.number().int().min(1).optional().default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ============================================================
// POST /device-sync/jobs — Create and enqueue a sync job
// ============================================================

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateJobSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const tenantId = req.context.tenantId;
    const result = await deviceSyncJobService.createJob(tenantId, parsed.data);

    res.status(202).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /device-sync/jobs — List jobs
// ============================================================

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ListJobsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const tenantId = req.context.tenantId;
    const { data, pagination } = await deviceSyncJobService.listJobs(tenantId, {
      customerId: parsed.data.customerId,
      status:     parsed.data.status as JobStatus | undefined,
      page:       parsed.data.page,
      pageSize:   parsed.data.pageSize,
    });

    res.status(200).json({ success: true, data, pagination });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /device-sync/jobs/:jobId — Get job status
// ============================================================

router.get('/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await deviceSyncJobService.getJobById(req.context.tenantId, req.params.jobId);

    const data = {
      jobId:        job.id,
      status:       job.status,
      currentPhase: job.currentPhase,
      dryRun:       job.dryRun,
      customerId:   job.customerId,
      summary:      job.phasesSummary,
      createdAt:    job.createdAt,
      updatedAt:    job.updatedAt,
      completedAt:  job.completedAt,
      durationMs:   job.completedAt
        ? job.completedAt.getTime() - job.createdAt.getTime()
        : null,
    };

    sendSuccess(res, data, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /device-sync/jobs/:jobId/log — Get structured log
// ============================================================

router.get('/:jobId/log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await deviceSyncJobService.getJobLog(req.context.tenantId, req.params.jobId);

    sendSuccess(res, result, 200, req.context.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
