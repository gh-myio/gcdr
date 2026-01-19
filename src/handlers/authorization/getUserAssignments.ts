import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const userId = event.pathParameters?.userId;

    if (!userId) {
      return handleError(new Error('User ID is required'));
    }

    const assignments = await authorizationService.getUserAssignments(ctx.tenantId, userId);

    return ok({
      userId,
      assignments,
    });
  } catch (err) {
    return handleError(err);
  }
};
