import { APIGatewayProxyHandler } from 'aws-lambda';
import { InviteUserSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { toUserDetailDTO } from '../../dto/response/UserResponseDTO';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = InviteUserSchema.parse(body);
    const user = await userService.invite(ctx.tenantId, data, ctx.userId);

    return created(toUserDetailDTO(user));
  } catch (err) {
    return handleError(err);
  }
};
