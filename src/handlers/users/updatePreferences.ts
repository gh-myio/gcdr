import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdatePreferencesSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { toUserDetailDTO } from '../../dto/response/UserResponseDTO';
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
    const preferences = UpdatePreferencesSchema.parse(body);

    const user = await userService.updatePreferences(ctx.tenantId, userId, preferences);

    return ok(toUserDetailDTO(user));
  } catch (err) {
    return handleError(err);
  }
};
