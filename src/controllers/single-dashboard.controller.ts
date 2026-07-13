import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { singleDashboardService } from '../services/SingleDashboardService';
import { sendSuccess } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';

// =============================================================================
// RFC-0053 — One-Store Dash (controller)
//
// GET /customers/:customerId/single-dashboard?from=&to=
// One composed, read-only snapshot for the single-store operational dashboard:
// device groups (energy/water/temperature/tanks), health score, goal progress
// (RFC-0046 + RFC-0052 adjusted targets), insights and per-section errors.
// Mounted with the standard hybrid auth (customers:read) in app.ts.
// =============================================================================

const router = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Optional ISO date/datetime window; forwarded to the telemetry read-through. */
const SingleDashboardQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/, 'from must be an ISO date').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/, 'to must be an ISO date').optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;

    if (!customerId || !UUID_REGEX.test(customerId)) {
      throw new ValidationError(`Invalid customerId: "${customerId ?? ''}"`);
    }

    const { from, to } = SingleDashboardQuerySchema.parse(req.query);
    const result = await singleDashboardService.get(tenantId, customerId, { from, to });
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export { router as singleDashboardController };
