import { APIGatewayProxyHandler } from 'aws-lambda';
import { userService } from '../../services/UserService';
import { toUserDetailDTO } from '../../dto/response/UserResponseDTO';
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

    const user = await userService.getById(ctx.tenantId, userId);

    return ok(toUserDetailDTO(user));
  } catch (err) {
    return handleError(err);
  }
};
