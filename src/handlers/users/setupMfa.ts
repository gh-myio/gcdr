import { APIGatewayProxyHandler } from 'aws-lambda';
import { EnableMfaSchema } from '../../dto/request/UserDTO';
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
    const data = EnableMfaSchema.parse(body);

    const setup = await userService.setupMfa(ctx.tenantId, userId, data.method);

    return ok(setup);
  } catch (err) {
    return handleError(err);
  }
};
