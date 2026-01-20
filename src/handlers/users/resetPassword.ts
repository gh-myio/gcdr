import { APIGatewayProxyHandler } from 'aws-lambda';
import { ResetPasswordSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = ResetPasswordSchema.parse(body);
    await userService.resetPassword(ctx.tenantId, data.token, data.newPassword);

    return ok({ message: 'Password reset successfully' });
  } catch (err) {
    return handleError(err);
  }
};
