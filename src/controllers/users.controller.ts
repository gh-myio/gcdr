import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userService } from '../services/UserService';
import {
  CreateUserSchema,
  UpdateUserSchema,
  ListUsersSchema,
  UpdateUserStatusSchema,
  InviteUserSchema,
  ChangePasswordSchema,
  EnableMfaSchema,
  UpdatePreferencesSchema
} from '../dto/request/UserDTO';
import { toUserDetailDTO, toUserSummaryDTO } from '../dto/response/UserResponseDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';
import { UserStatus } from '../domain/entities/User';

const router = Router();

// Schema for MFA confirmation
const EnableMfaConfirmSchema = z.object({
  method: z.enum(['totp', 'sms', 'email']),
  secret: z.string().min(1),
  verificationCode: z.string().min(6).max(6),
});

/**
 * GET /users/me
 * Get current authenticated user
 */
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const user = await userService.getById(tenantId, userId);
    sendSuccess(res, toUserDetailDTO(user), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /users
 * Create a new user
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateUserSchema.parse(req.body);
    const user = await userService.create(tenantId, data, userId);
    sendCreated(res, toUserDetailDTO(user), requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /users/invite
 * Invite a new user
 */
router.post('/invite', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = InviteUserSchema.parse(req.body);
    const user = await userService.invite(tenantId, data, userId);
    sendCreated(res, toUserDetailDTO(user), requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /users
 * List users
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    const params = ListUsersSchema.parse({
      customerId: req.query.customerId,
      partnerId: req.query.partnerId,
      type: req.query.type,
      status: req.query.status,
      search: req.query.search,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      cursor: req.query.cursor,
    });

    const result = await userService.list(tenantId, params);
    sendSuccess(res, {
      items: result.items.map(toUserSummaryDTO),
      pagination: result.pagination,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /users/:id
 * Get user by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const user = await userService.getById(tenantId, id);
    sendSuccess(res, toUserDetailDTO(user), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /users/:id
 * Update user
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const data = UpdateUserSchema.parse(req.body);
    const user = await userService.update(tenantId, id, data, userId);
    sendSuccess(res, toUserDetailDTO(user), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /users/:id
 * Delete user
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    await userService.delete(tenantId, id, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /users/:id/status
 * Update user status
 */
router.patch('/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const data = UpdateUserStatusSchema.parse(req.body);
    const user = await userService.updateStatus(
      tenantId,
      id,
      data.status as UserStatus,
      userId,
      data.reason
    );
    sendSuccess(res, toUserDetailDTO(user), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /users/:id/unlock
 * Unlock a locked user account
 */
router.post('/:id/unlock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const user = await userService.unlockUser(tenantId, id, userId);
    sendSuccess(res, toUserDetailDTO(user), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /users/:id/change-password
 * Change user password
 */
router.post('/:id/change-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const data = ChangePasswordSchema.parse(req.body);
    await userService.changePassword(tenantId, id, data);
    sendSuccess(res, { message: 'Password changed successfully' }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /users/:id/mfa/setup
 * Setup MFA for user
 */
router.post('/:id/mfa/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const data = EnableMfaSchema.parse(req.body);
    const setup = await userService.setupMfa(tenantId, id, data.method);
    sendSuccess(res, setup, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /users/:id/mfa/enable
 * Enable MFA after verification
 */
router.post('/:id/mfa/enable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const data = EnableMfaConfirmSchema.parse(req.body);
    await userService.enableMfa(tenantId, id, data.method, data.secret, data.verificationCode);
    sendSuccess(res, { message: 'MFA enabled successfully' }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /users/:id/mfa/disable
 * Disable MFA for user
 */
router.post('/:id/mfa/disable', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    await userService.disableMfa(tenantId, id, userId);
    sendSuccess(res, { message: 'MFA disabled successfully' }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /users/:id/preferences
 * Update user preferences
 */
router.patch('/:id/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const preferences = UpdatePreferencesSchema.parse(req.body);
    const user = await userService.updatePreferences(tenantId, id, preferences);
    sendSuccess(res, toUserDetailDTO(user), 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /customers/:customerId/users
 * List users by customer (mounted in app.ts)
 */
export const listByCustomerHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { customerId } = req.params;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const users = await userService.listByCustomer(tenantId, customerId);
    sendSuccess(res, { items: users.map(toUserSummaryDTO) }, 200, requestId);
  } catch (err) {
    next(err);
  }
};

export default router;
