import { APIGatewayProxyHandler } from 'aws-lambda';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * GET /groups/{id}
 * Get a group by ID
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const groupId = event.pathParameters?.id;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const group = await groupService.getGroup(ctx.tenantId, groupId);

    return ok(group);
  } catch (err) {
    return handleError(err);
  }
};
