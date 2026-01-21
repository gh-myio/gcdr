import { APIGatewayProxyHandler } from 'aws-lambda';
import { groupService } from '../../services/GroupService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * DELETE /groups/{id}
 * Delete a group
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const groupId = event.pathParameters?.id;

    if (!groupId) {
      throw new ValidationError('Group ID is required');
    }

    // Use soft delete by default
    const hardDelete = event.queryStringParameters?.hard === 'true';

    if (hardDelete) {
      await groupService.deleteGroup(ctx.tenantId, groupId);
    } else {
      await groupService.softDeleteGroup(ctx.tenantId, groupId, ctx.userId);
    }

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
