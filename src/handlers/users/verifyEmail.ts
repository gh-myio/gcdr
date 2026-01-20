import { APIGatewayProxyHandler } from 'aws-lambda';
import { VerifyEmailSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { toUserDetailDTO } from '../../dto/response/UserResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = VerifyEmailSchema.parse(body);
    const user = await userService.verifyEmail(ctx.tenantId, data.token);

    return ok(toUserDetailDTO(user));
  } catch (err) {
    return handleError(err);
  }
};
