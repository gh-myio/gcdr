import { APIGatewayProxyHandler } from 'aws-lambda';
import { userService } from '../../services/UserService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const userId = event.pathParameters?.id;

    if (!userId) {
      return handleError(new Error('User ID is required'));
    }

    await userService.disableMfa(ctx.tenantId, userId, ctx.userId);

    return ok({ message: 'MFA disabled successfully' });
  } catch (err) {
    return handleError(err);
  }
};
