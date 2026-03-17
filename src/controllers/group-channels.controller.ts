import { Router, Request, Response, NextFunction } from 'express';
import { groupChannelService } from '../services/GroupChannelService';
import { PutGroupChannelsSchema, PatchGroupChannelSchema } from '../dto/request/GroupChannelDTO';
import { sendSuccess, sendNoContent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';

const router = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /groups/:groupId/channels
 * List all configured channels for a group
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId } = req.params;
    if (!UUID_REGEX.test(groupId)) throw new ValidationError(`Invalid groupId: "${groupId}"`);
    const channels = await groupChannelService.list(tenantId, groupId);
    sendSuccess(res, { items: channels, count: channels.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /groups/:groupId/channels
 * Replace all channel configs for a group (idempotent full replace)
 */
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId } = req.params;
    if (!UUID_REGEX.test(groupId)) throw new ValidationError(`Invalid groupId: "${groupId}"`);
    const data = PutGroupChannelsSchema.parse(req.body);
    const channels = await groupChannelService.put(tenantId, groupId, data);
    sendSuccess(res, { items: channels, count: channels.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /groups/:groupId/channels/:channel
 * Update a single channel config (active, target, config)
 */
router.patch('/:channel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId, channel } = req.params;
    if (!UUID_REGEX.test(groupId)) throw new ValidationError(`Invalid groupId: "${groupId}"`);
    const data = PatchGroupChannelSchema.parse(req.body);
    const updated = await groupChannelService.patchChannel(tenantId, groupId, channel, data);
    sendSuccess(res, updated, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /groups/:groupId/channels/:channel
 * Remove a channel from a group
 */
router.delete('/:channel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId, channel } = req.params;
    if (!UUID_REGEX.test(groupId)) throw new ValidationError(`Invalid groupId: "${groupId}"`);
    await groupChannelService.deleteChannel(tenantId, groupId, channel);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

export default router;
