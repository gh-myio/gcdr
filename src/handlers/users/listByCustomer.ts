import { APIGatewayProxyHandler } from 'aws-lambda';
import { userService } from '../../services/UserService';
import { toUserSummaryDTO } from '../../dto/response/UserResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;

    if (!customerId) {
      return handleError(new Error('Customer ID is required'));
    }

    const users = await userService.listByCustomer(ctx.tenantId, customerId);

    return ok({
      items: users.map(toUserSummaryDTO),
    });
  } catch (err) {
    return handleError(err);
  }
};
