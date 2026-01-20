import { APIGatewayProxyHandler } from 'aws-lambda';
import { userService } from '../../services/UserService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const userId = event.pathParameters?.id;

    if (!userId) {
      return handleError(new Error('User ID is required'));
    }

    await userService.delete(ctx.tenantId, userId, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
