import { Router, Request, Response, NextFunction } from 'express';
import { authorizationService } from '../services/AuthorizationService';
import { CreateRoleSchema, UpdateRoleSchema } from '../dto/request/AuthorizationDTO';
import { sendSuccess, sendCreated, sendNoContent, logEvent } from '../middleware';
import { ValidationError } from '../shared/errors/AppError';
import { EventType } from '../shared/types';

const router = Router();

/**
 * POST /roles
 * Create a new role
 */
router.post('/',
  logEvent({
    eventType: EventType.ROLE_CREATED,
    description: (req) => `Role "${req.body.displayName}" created`,
    getEntityId: (req, res) => res.locals.responseBody?.data?.id,
    getMetadata: (req) => ({ roleKey: req.body.key, riskLevel: req.body.riskLevel }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const data = CreateRoleSchema.parse(req.body);
      const role = await authorizationService.createRole(tenantId, data, userId);
      sendCreated(res, role, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /roles
 * List roles
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
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

/**
 * GET /roles/:roleId
 * Get role by ID
 */
router.get('/:roleId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { roleId } = req.params;

    if (!roleId) {
      throw new ValidationError('Role ID is required');
    }

    const role = await authorizationService.getRoleById(tenantId, roleId);
    sendSuccess(res, role, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /roles/key/:roleKey
 * Get role by key
 */
router.get('/key/:roleKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { roleKey } = req.params;

    if (!roleKey) {
      throw new ValidationError('Role key is required');
    }

    const role = await authorizationService.getRoleByKey(tenantId, roleKey);
    sendSuccess(res, role, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /roles/:roleId
 * Update role
 */
router.put('/:roleId',
  logEvent({
    eventType: EventType.ROLE_UPDATED,
    description: (req) => `Role ${req.params.roleId} updated`,
    getEntityId: (req) => req.params.roleId,
    getMetadata: (req) => ({ updatedFields: Object.keys(req.body) }),
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId, requestId } = req.context;
      const { roleId } = req.params;

      if (!roleId) {
        throw new ValidationError('Role ID is required');
      }

      const data = UpdateRoleSchema.parse(req.body);
      const role = await authorizationService.updateRole(tenantId, roleId, data, userId);
      sendSuccess(res, role, 200, requestId);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /roles/:roleId
 * Delete role
 */
router.delete('/:roleId',
  logEvent({
    eventType: EventType.ROLE_DELETED,
    description: (req) => `Role ${req.params.roleId} deleted`,
    getEntityId: (req) => req.params.roleId,
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, userId } = req.context;
      const { roleId } = req.params;

      if (!roleId) {
        throw new ValidationError('Role ID is required');
      }

      await authorizationService.deleteRole(tenantId, roleId, userId);
      sendNoContent(res);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
