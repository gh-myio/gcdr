import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateGroupSchema } from '../../dto/request/GroupDTO';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * PUT /groups/{id}
 * Update a group
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const groupId = event.pathParameters?.id;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const body = parseBody(event);
    const data = UpdateGroupSchema.parse(body);

    const group = await groupService.updateGroup(ctx.tenantId, groupId, data, ctx.userId);

    return ok(group);
  } catch (err) {
    return handleError(err);
  }
};
