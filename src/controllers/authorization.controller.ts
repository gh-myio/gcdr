import { Router, Request, Response, NextFunction } from 'express';
import { authorizationService } from '../services/AuthorizationService';
import {
  EvaluatePermissionSchema,
  AssignRoleSchema,
  EvaluateBatchSchema
} from '../dto/request/AuthorizationDTO';
import { sendSuccess, sendCreated } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

/**
 * POST /authorization/check
 * Check if a permission is allowed
 */
router.post('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = EvaluatePermissionSchema.parse(req.body);
    const result = await authorizationService.evaluatePermission(tenantId, data, userId);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /authorization/check/batch
 * Evaluate multiple permissions in batch
 */
router.post('/check/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = EvaluateBatchSchema.parse(req.body);
    const result = await authorizationService.evaluateBatch(tenantId, data, userId);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /authorization/assignments
 * Assign a role to a user
 */
router.post('/assignments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = AssignRoleSchema.parse(req.body);
    const assignment = await authorizationService.assignRole(tenantId, data, userId);
    sendCreated(res, assignment, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /authorization/assignments
 * List all role assignments
 */
router.get('/assignments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor } = req.query;

    const params = {
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
    };

    const result = await authorizationService.listAssignments(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /authorization/assignments/:assignmentId
 * Revoke a role assignment
 */
router.delete('/assignments/:assignmentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { assignmentId } = req.params;

    if (!assignmentId) {
      throw new ValidationError('Assignment ID is required');
    }

    const assignment = await authorizationService.revokeAssignment(tenantId, assignmentId, userId);
    sendSuccess(res, assignment, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /authorization/users/:userId/assignments
 * Get role assignments for a user
 */
router.get('/users/:userId/assignments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { userId } = req.params;

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const assignments = await authorizationService.getUserAssignments(tenantId, userId);
    sendSuccess(res, { userId, assignments }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /authorization/users/:userId/permissions
 * Get effective permissions for a user
 */
router.get('/users/:userId/permissions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { userId } = req.params;
    const { scope } = req.query;

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const permissions = await authorizationService.getEffectivePermissions(
      tenantId,
      userId,
      scope as string | undefined
    );
    const assignments = await authorizationService.getUserAssignments(tenantId, userId);

    sendSuccess(res, {
      userId,
      scope: scope || '*',
      effectivePermissions: permissions.filter((p) => p.allowed).map((p) => p.permission),
      deniedPatterns: permissions.filter((p) => !p.allowed).map((p) => p.permission),
      roles: assignments.map((a) => ({
        roleKey: a.roleKey,
        scope: a.scope,
        grantedAt: a.grantedAt,
      })),
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /authorization/users/:userId/roles
 * Get all roles and permissions for a user
 */
router.get('/users/:userId/roles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { userId } = req.params;

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const assignments = await authorizationService.getUserAssignments(tenantId, userId);
    const effectivePermissions = await authorizationService.getEffectivePermissions(tenantId, userId);

    sendSuccess(res, {
      userId,
      assignments: assignments.map((a) => ({
        id: a.id,
        roleKey: a.roleKey,
        scope: a.scope,
        status: a.status,
        grantedAt: a.grantedAt,
        grantedBy: a.grantedBy,
        expiresAt: a.expiresAt,
      })),
      effectivePermissions: effectivePermissions.filter((p) => p.allowed).map((p) => p.permission),
      deniedPatterns: effectivePermissions.filter((p) => !p.allowed).map((p) => p.permission),
      count: assignments.length,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /authorization/roles
 * List all roles
 */
router.get('/roles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { limit, cursor, riskLevel, isSystem } = req.query;

    const params = {
      limit: limit ? parseInt(limit as string, 10) : undefined,
      cursor: cursor as string | undefined,
      riskLevel: riskLevel as string | undefined,
      isSystem: isSystem === 'true' ? true : isSystem === 'false' ? false : undefined,
    };

    const result = await authorizationService.listRoles(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
