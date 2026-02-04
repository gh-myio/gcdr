import { Router, Request, Response, NextFunction } from 'express';
import { groupService } from '../services/GroupService';
import {
  CreateGroupSchema,
  UpdateGroupSchema,
  AddMembersSchema,
  RemoveMembersSchema,
  ListGroupsQuerySchema,
} from '../dto/request/GroupDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError } from '../shared/errors/AppError';

const router = Router();

/**
 * POST /groups
 * Create a new group
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { customerId } = req.body;

    if (!customerId) {
      throw new ValidationError('customerId is required');
    }

    const data = CreateGroupSchema.parse(req.body);
    const group = await groupService.createGroup(tenantId, customerId, data, userId);
    sendCreated(res, group, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups
 * List groups with filters
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const params = ListGroupsQuerySchema.parse(req.query);
    const result = await groupService.listGroups(tenantId, params);
    sendSuccess(res, result, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups/:id
 * Get group by ID
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const group = await groupService.getGroup(tenantId, id);
    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /groups/:id
 * Update group
 */
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const data = UpdateGroupSchema.parse(req.body);
    const group = await groupService.updateGroup(tenantId, id, data, userId);
    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /groups/:id
 * Delete group
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId } = req.context;
    const { id } = req.params;
    const { soft } = req.query;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    if (soft === 'true') {
      await groupService.softDeleteGroup(tenantId, id, userId);
    } else {
      await groupService.deleteGroup(tenantId, id);
    }

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /groups/:id/members
 * Add members to group
 */
router.post('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const data = AddMembersSchema.parse(req.body);
    const group = await groupService.addMembers(tenantId, id, data, userId);
    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /groups/:id/members
 * Remove members from group
 */
router.delete('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const data = RemoveMembersSchema.parse(req.body);
    const group = await groupService.removeMembers(tenantId, id, data.memberIds, userId);
    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups/:id/children
 * Get child groups
 */
router.get('/:id/children', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const children = await groupService.getChildGroups(tenantId, id);
    sendSuccess(res, children, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups/:id/descendants
 * Get all descendant groups
 */
router.get('/:id/descendants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const descendants = await groupService.getDescendantGroups(tenantId, id);
    sendSuccess(res, descendants, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /groups/:id/move
 * Move group to new parent
 */
router.post('/:id/move', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, userId, requestId } = req.context;
    const { id } = req.params;
    const { newParentGroupId } = req.body;

    if (!id) {
      throw new ValidationError('Group ID is required');
    }

    const group = await groupService.moveGroup(tenantId, id, newParentGroupId || null, userId);
    sendSuccess(res, group, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups/by-member/:memberId
 * Get groups by member
 */
router.get('/by-member/:memberId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;
    const { memberId } = req.params;
    const { memberType } = req.query;

    if (!memberId) {
      throw new ValidationError('Member ID is required');
    }

    if (!memberType || !['USER', 'DEVICE', 'ASSET'].includes(memberType as string)) {
      throw new ValidationError('memberType query param is required (USER, DEVICE, or ASSET)');
    }

    const groups = await groupService.getGroupsByMember(
      tenantId,
      memberId,
      memberType as 'USER' | 'DEVICE' | 'ASSET'
    );
    sendSuccess(res, groups, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
