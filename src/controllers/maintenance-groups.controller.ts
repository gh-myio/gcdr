import { Router, Request, Response, NextFunction } from 'express';
import { maintenanceGroupService } from '../services/MaintenanceGroupService';
import {
  CreateMaintenanceGroupSchema,
  UpdateMaintenanceGroupSchema,
  ListMaintenanceGroupsQuerySchema,
  AddGroupMemberSchema,
  AddGroupMembersSchema,
  RemoveGroupMembersSchema,
} from '../dto/request/MaintenanceGroupDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError, NotFoundError } from '../shared/errors/AppError';

const router = Router();

// =============================================================================
// Group CRUD
// =============================================================================

/**
 * POST /maintenance-groups
 * Create a new maintenance group
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const data = CreateMaintenanceGroupSchema.parse(req.body);
    const group = await maintenanceGroupService.createGroup(tenantId, data, userId);
    sendCreated(res, group, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /maintenance-groups
 * List maintenance groups
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const params = ListMaintenanceGroupsQuerySchema.parse(req.query);
    const result = await maintenanceGroupService.listGroups(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /maintenance-groups/:groupId
 * Get maintenance group by ID
 */
router.get('/:groupId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId } = req.params;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const group = await maintenanceGroupService.getGroupById(tenantId, groupId);
    if (!group) {
      throw new NotFoundError('Maintenance group not found');
    }

    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /maintenance-groups/:groupId/details
 * Get maintenance group with members
 */
router.get('/:groupId/details', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId } = req.params;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const group = await maintenanceGroupService.getGroupWithMembers(tenantId, groupId);
    if (!group) {
      throw new NotFoundError('Maintenance group not found');
    }

    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /maintenance-groups/key/:key
 * Get maintenance group by key
 */
router.get('/key/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { key } = req.params;

    if (!key) {
      throw new ValidationError('Group key is required');
    }

    const group = await maintenanceGroupService.getGroupByKey(tenantId, key);
    if (!group) {
      throw new NotFoundError('Maintenance group not found');
    }

    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /maintenance-groups/:groupId
 * Update maintenance group
 */
router.put('/:groupId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { groupId } = req.params;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const data = UpdateMaintenanceGroupSchema.parse(req.body);
    const group = await maintenanceGroupService.updateGroup(tenantId, groupId, data, userId);
    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /maintenance-groups/:groupId
 * Delete maintenance group
 */
router.delete('/:groupId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { groupId } = req.params;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    await maintenanceGroupService.deleteGroup(tenantId, groupId, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Member Management
// =============================================================================

/**
 * GET /maintenance-groups/:groupId/members
 * Get group members
 */
router.get('/:groupId/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { groupId } = req.params;
    const { includeExpired } = req.query;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const members = await maintenanceGroupService.getMembers(
      tenantId,
      groupId,
      includeExpired === 'true'
    );
    sendSuccess(res, { members }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /maintenance-groups/:groupId/members
 * Add a single member to group
 */
router.post('/:groupId/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { groupId } = req.params;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const data = AddGroupMemberSchema.parse(req.body);
    await maintenanceGroupService.addMember(tenantId, groupId, data.userId, userId, data.expiresAt);

    sendSuccess(res, { message: 'Member added successfully' }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /maintenance-groups/:groupId/members/bulk
 * Add multiple members to group
 */
router.post('/:groupId/members/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { groupId } = req.params;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const data = AddGroupMembersSchema.parse(req.body);
    await maintenanceGroupService.addMembers(tenantId, groupId, data.userIds, userId, data.expiresAt);

    sendSuccess(res, { message: `${data.userIds.length} members added successfully` }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /maintenance-groups/:groupId/members/:userId
 * Remove a single member from group
 */
router.delete('/:groupId/members/:memberId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { groupId, memberId } = req.params;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }
    if (!memberId) {
      throw new ValidationError('Member user ID is required');
    }

    await maintenanceGroupService.removeMember(tenantId, groupId, memberId, userId);
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /maintenance-groups/:groupId/members/remove
 * Remove multiple members from group
 */
router.post('/:groupId/members/remove', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { groupId } = req.params;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const data = RemoveGroupMembersSchema.parse(req.body);
    await maintenanceGroupService.removeMembers(tenantId, groupId, data.userIds, userId);

    sendSuccess(res, { message: `${data.userIds.length} members removed successfully` }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// User's Groups
// =============================================================================

/**
 * GET /maintenance-groups/user/:userId
 * Get groups for a specific user
 */
router.get('/user/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { userId } = req.params;
    const { includeExpired } = req.query;

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const groups = await maintenanceGroupService.getUserGroups(
      tenantId,
      userId,
      includeExpired === 'true'
    );
    sendSuccess(res, { groups }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
