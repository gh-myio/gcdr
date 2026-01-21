import { APIGatewayProxyHandler } from 'aws-lambda';
import { RemoveMembersSchema } from '../../dto/request/GroupDTO';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * DELETE /groups/{id}/members
 * Remove members from a group
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const groupId = event.pathParameters?.id;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const body = parseBody(event);
    const data = RemoveMembersSchema.parse(body);

    const group = await groupService.removeMembers(ctx.tenantId, groupId, data.memberIds, ctx.userId);

    return ok(group);
  } catch (err) {
    return handleError(err);
  }
};
