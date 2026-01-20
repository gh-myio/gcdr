import { APIGatewayProxyHandler } from 'aws-lambda';
import { z } from 'zod';
import { userService } from '../../services/UserService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

const EnableMfaConfirmSchema = z.object({
  method: z.enum(['totp', 'sms', 'email']),
  secret: z.string().min(1),
  verificationCode: z.string().min(6).max(6),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const userId = event.pathParameters?.id;

    if (!userId) {
      return handleError(new Error('User ID is required'));
    }

    const body = parseBody(event);
    const data = EnableMfaConfirmSchema.parse(body);

    await userService.enableMfa(
      ctx.tenantId,
      userId,
      data.method,
      data.secret,
      data.verificationCode
    );

    return ok({ message: 'MFA enabled successfully' });
  } catch (err) {
    return handleError(err);
  }
};
