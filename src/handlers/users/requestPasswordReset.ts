import { APIGatewayProxyHandler } from 'aws-lambda';
import { RequestPasswordResetSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = RequestPasswordResetSchema.parse(body);
    await userService.requestPasswordReset(ctx.tenantId, data.email);

    // Always return success to prevent email enumeration
    return ok({ message: 'If the email exists, a password reset link has been sent' });
  } catch (err) {
    return handleError(err);
  }
};
