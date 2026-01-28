/**
 * RFC-0011: Admin User Management Controller
 * Endpoints for user approval, rejection, and unlock operations
 */

import { Router, Request, Response, NextFunction } from 'express';
import { registrationService } from '../../services/RegistrationService';
import { ApproveUserRequestSchema, RejectUserRequestSchema } from '../../dto/request/AuthDTO';
import { sendSuccess, sendNoContent } from '../../middleware/response';
import { ValidationError } from '../../shared/errors/AppError';
import { authMiddleware } from '../../middleware';

const router = Router();

// All admin routes require authentication
router.use(authMiddleware);

/**
 * GET /admin/users/pending-approval
 * List users pending approval
 */
router.get('/pending-approval', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    const users = await registrationService.listPendingApproval(tenantId);

    sendSuccess(res, { items: users, total: users.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/users/:userId/approve
 * Approve user registration
 */
router.post('/:userId/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId: approvedBy, requestId } = req.context;
    const { userId } = req.params;

    if (!userId) {
      throw new ValidationError('User ID é obrigatório');
    }

    const result = ApproveUserRequestSchema.safeParse(req.body);
    // Validation is optional for approve - defaults are fine

    await registrationService.approveUser(tenantId, userId, approvedBy);

    // TODO: If assignRoles is provided, assign roles to user
    if (result.success && result.data.assignRoles) {
      // await roleService.assignRoles(tenantId, userId, result.data.assignRoles, approvedBy);
      console.log(`[ADMIN] Would assign roles ${result.data.assignRoles.join(', ')} to user ${userId}`);
    }

    sendSuccess(res, {
      userId,
      status: 'ACTIVE',
      message: 'Usuário aprovado com sucesso',
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/users/:userId/reject
 * Reject user registration
 */
router.post('/:userId/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId: rejectedBy, requestId } = req.context;
    const { userId } = req.params;

    if (!userId) {
      throw new ValidationError('User ID é obrigatório');
    }

    const result = RejectUserRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Motivo da rejeição é obrigatório', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { reason } = result.data;

    await registrationService.rejectUser(tenantId, userId, rejectedBy, reason);

    sendSuccess(res, {
      userId,
      status: 'INACTIVE',
      message: 'Cadastro do usuário rejeitado',
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/users/:userId/unlock
 * Unlock user account
 */
router.post('/:userId/unlock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId: unlockedBy, requestId } = req.context;
    const { userId } = req.params;

    if (!userId) {
      throw new ValidationError('User ID é obrigatório');
    }

    await registrationService.unlockUser(tenantId, userId, unlockedBy);

    sendSuccess(res, {
      userId,
      status: 'ACTIVE',
      failedLoginAttempts: 0,
      message: 'Conta do usuário desbloqueada',
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/users/locked
 * List locked users
 */
router.get('/locked', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    // Use the userRepository to list locked users
    const { userRepository } = await import('../../repositories/UserRepository');
    const result = await userRepository.list(tenantId, { status: 'LOCKED' });

    const users = result.items.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      lockedAt: user.security.lockedAt,
      lockedReason: user.security.lockedReason,
      lockoutCount: user.security.lockoutCount,
      failedLoginAttempts: user.security.failedLoginAttempts,
    }));

    sendSuccess(res, { items: users, total: users.length }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export { router as userAdminController };
