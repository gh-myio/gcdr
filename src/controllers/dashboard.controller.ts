import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../middleware/response';
import { AppError } from '../shared/errors/AppError';
import { dashboardService } from '../services/DashboardService';

const router = Router();

/**
 * GET /dashboard
 * Returns a summary for the dashboard:
 *  - rules: total, byType, byPriority, enabled/disabled, recentlyTriggered24h
 *  - audit: event counts for 24h / 72h / 1 week / 1 month, grouped by category and action
 *  - devices: total, byConnectivity, health (mock — see _note for future implementation)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('UNAUTHORIZED', 'Tenant ID required', 401);
    }

    const summary = await dashboardService.getSummary(tenantId);
    sendSuccess(res, summary, 200, req.context?.requestId);
  } catch (error) {
    next(error);
  }
});

export const dashboardController = router;
