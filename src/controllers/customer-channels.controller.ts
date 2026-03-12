import { Router, Request, Response, NextFunction } from 'express';
import { customerChannelService } from '../services/CustomerChannelService';
import { CreateCustomerChannelSchema, UpdateCustomerChannelSchema } from '../dto/request/CustomerChannelDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';

const router = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /customers/:customerId/channels
 * List all dispatch channels configured for a customer
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;

    if (!UUID_REGEX.test(customerId)) throw new ValidationError(`Invalid customerId: "${customerId}"`);

    const channels = await customerChannelService.list(tenantId, customerId);
    sendSuccess(res, { items: channels, count: channels.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /customers/:customerId/channels
 * Add a new dispatch channel to a customer
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { customerId } = req.params;

    if (!UUID_REGEX.test(customerId)) throw new ValidationError(`Invalid customerId: "${customerId}"`);

    const data = CreateCustomerChannelSchema.parse(req.body);
    const channel = await customerChannelService.create(tenantId, customerId, data, userId);
    sendCreated(res, channel, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /customers/:customerId/channels/:channelId
 * Update active flag or config of a customer channel
 */
router.patch('/:channelId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId, channelId } = req.params;

    if (!UUID_REGEX.test(customerId)) throw new ValidationError(`Invalid customerId: "${customerId}"`);
    if (!UUID_REGEX.test(channelId))  throw new ValidationError(`Invalid channelId: "${channelId}"`);

    const data = UpdateCustomerChannelSchema.parse(req.body);
    const channel = await customerChannelService.update(tenantId, customerId, channelId, data);
    sendSuccess(res, channel, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /customers/:customerId/channels/:channelId
 * Remove a dispatch channel from a customer
 */
router.delete('/:channelId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const { customerId, channelId } = req.params;

    if (!UUID_REGEX.test(customerId)) throw new ValidationError(`Invalid customerId: "${customerId}"`);
    if (!UUID_REGEX.test(channelId))  throw new ValidationError(`Invalid channelId: "${channelId}"`);

    await customerChannelService.delete(tenantId, customerId, channelId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

export default router;
