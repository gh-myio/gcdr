import { Router, Request, Response, NextFunction } from 'express';
import { userContactService } from '../services/UserContactService';
import { CreateUserContactSchema, UpdateUserContactSchema } from '../dto/request/UserContactDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';

const router = Router({ mergeParams: true });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /users/:userId/contacts
 * List all notification contacts for a user
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { userId } = req.params;

    if (!UUID_REGEX.test(userId)) throw new ValidationError(`Invalid userId: "${userId}"`);

    const contacts = await userContactService.list(tenantId, userId);
    sendSuccess(res, { items: contacts, count: contacts.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /users/:userId/contacts
 * Add a notification contact to a user
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { userId } = req.params;

    if (!UUID_REGEX.test(userId)) throw new ValidationError(`Invalid userId: "${userId}"`);

    const data = CreateUserContactSchema.parse(req.body);
    const contact = await userContactService.create(tenantId, userId, data);
    sendCreated(res, contact, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /users/:userId/contacts/:contactId
 * Update a user contact (value, label, active)
 */
router.patch('/:contactId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { userId, contactId } = req.params;

    if (!UUID_REGEX.test(userId))    throw new ValidationError(`Invalid userId: "${userId}"`);
    if (!UUID_REGEX.test(contactId)) throw new ValidationError(`Invalid contactId: "${contactId}"`);

    const data = UpdateUserContactSchema.parse(req.body);
    const contact = await userContactService.update(tenantId, userId, contactId, data);
    sendSuccess(res, contact, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /users/:userId/contacts/:contactId
 * Remove a notification contact from a user
 */
router.delete('/:contactId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;
    const { userId, contactId } = req.params;

    if (!UUID_REGEX.test(userId))    throw new ValidationError(`Invalid userId: "${userId}"`);
    if (!UUID_REGEX.test(contactId)) throw new ValidationError(`Invalid contactId: "${contactId}"`);

    await userContactService.delete(tenantId, userId, contactId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

export default router;
