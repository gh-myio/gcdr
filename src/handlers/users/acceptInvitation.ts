import { APIGatewayProxyHandler } from 'aws-lambda';
import { AcceptInvitationSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { toUserDetailDTO } from '../../dto/response/UserResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = AcceptInvitationSchema.parse(body);
    const user = await userService.acceptInvitation(ctx.tenantId, data.token, data.password);

    return ok(toUserDetailDTO(user));
  } catch (err) {
    return handleError(err);
  }
};
