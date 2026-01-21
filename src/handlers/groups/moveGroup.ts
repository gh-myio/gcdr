import { APIGatewayProxyHandler } from 'aws-lambda';
import { z } from 'zod';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

const MoveGroupSchema = z.object({
  parentGroupId: z.string().uuid().nullable(),
});

/**
 * POST /groups/{id}/move
 * Move a group to a new parent (or to root if parentGroupId is null)
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const groupId = event.pathParameters?.id;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const body = parseBody(event);
    const data = MoveGroupSchema.parse(body);

    const group = await groupService.moveGroup(
      ctx.tenantId,
      groupId,
      data.parentGroupId,
      ctx.userId
    );

    return ok(group);
  } catch (err) {
    return handleError(err);
  }
};
