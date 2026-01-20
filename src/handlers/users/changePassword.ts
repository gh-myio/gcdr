import { APIGatewayProxyHandler } from 'aws-lambda';
import { ChangePasswordSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const userId = event.pathParameters?.id;

    if (!userId) {
      return handleError(new Error('User ID is required'));
    }

    const body = parseBody(event);
    const data = ChangePasswordSchema.parse(body);

    await userService.changePassword(ctx.tenantId, userId, data);

    return ok({ message: 'Password changed successfully' });
  } catch (err) {
    return handleError(err);
  }
};
