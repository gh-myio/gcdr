import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateUserStatusSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { toUserDetailDTO } from '../../dto/response/UserResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { UserStatus } from '../../domain/entities/User';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const userId = event.pathParameters?.id;

    if (!userId) {
      return handleError(new Error('User ID is required'));
    }

    const body = parseBody(event);
    const data = UpdateUserStatusSchema.parse(body);

    const user = await userService.updateStatus(
      ctx.tenantId,
      userId,
      data.status as UserStatus,
      ctx.userId,
      data.reason
    );

    return ok(toUserDetailDTO(user));
  } catch (err) {
    return handleError(err);
  }
};
