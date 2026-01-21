import { APIGatewayProxyHandler } from 'aws-lambda';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * GET /groups/{id}/children
 * Get direct child groups
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const groupId = event.pathParameters?.id;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    const children = await groupService.getChildGroups(ctx.tenantId, groupId);

    return ok({ items: children });
  } catch (err) {
    return handleError(err);
  }
};
