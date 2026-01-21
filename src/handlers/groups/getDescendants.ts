import { APIGatewayProxyHandler } from 'aws-lambda';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * GET /groups/{id}/descendants
 * Get all descendant groups (children, grandchildren, etc.)
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const groupId = event.pathParameters?.id;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const descendants = await groupService.getDescendantGroups(ctx.tenantId, groupId);

    return ok({ items: descendants });
  } catch (err) {
    return handleError(err);
  }
};
