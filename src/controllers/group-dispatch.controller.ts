import { Router, Request, Response, NextFunction } from 'express';
import { groupDispatchConfigService } from '../services/GroupDispatchConfigService';
import { PutGroupDispatchSchema, PatchGroupDispatchSchema } from '../dto/request/GroupDispatchDTO';
import { sendSuccess } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';

const router = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /groups/:groupId/dispatch
 * Get the full dispatch matrix for a group (channel × action × active)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId } = req.params;

    if (!UUID_REGEX.test(groupId)) throw new ValidationError(`Invalid groupId: "${groupId}"`);

    const entries = await groupDispatchConfigService.list(tenantId, groupId);
    sendSuccess(res, { items: entries, count: entries.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /groups/:groupId/dispatch
 * Replace the entire dispatch matrix for a group (idempotent full replace)
 */
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId } = req.params;

    if (!UUID_REGEX.test(groupId)) throw new ValidationError(`Invalid groupId: "${groupId}"`);

    const data = PutGroupDispatchSchema.parse(req.body);
    const entries = await groupDispatchConfigService.put(tenantId, groupId, data);
    sendSuccess(res, { items: entries, count: entries.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /groups/:groupId/dispatch
 * Partially update specific entries in the dispatch matrix
 */
router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId } = req.params;

    if (!UUID_REGEX.test(groupId)) throw new ValidationError(`Invalid groupId: "${groupId}"`);

    const data = PatchGroupDispatchSchema.parse(req.body);
    const entries = await groupDispatchConfigService.patch(tenantId, groupId, data);
    sendSuccess(res, { items: entries, count: entries.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
