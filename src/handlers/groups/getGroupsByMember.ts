import { APIGatewayProxyHandler } from 'aws-lambda';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * GET /groups/by-member/{memberType}/{memberId}
 * Get all groups that contain a specific member
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const memberId = event.pathParameters?.memberId;
    const memberType = event.pathParameters?.memberType?.toUpperCase() as 'USER' | 'DEVICE' | 'ASSET';

    if (!memberId) {
      throw new ValidationError('Member ID is required');
    }

    if (!memberType || !['USER', 'DEVICE', 'ASSET'].includes(memberType)) {
      throw new ValidationError('Valid member type is required (USER, DEVICE, or ASSET)');
    }

    const groups = await groupService.getGroupsByMember(ctx.tenantId, memberId, memberType);

    return ok({ items: groups });
  } catch (err) {
    return handleError(err);
  }
};
