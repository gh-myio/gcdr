import { APIGatewayProxyHandler } from 'aws-lambda';
import { ListUsersSchema } from '../../dto/request/UserDTO';
import { userService } from '../../services/UserService';
import { toUserSummaryDTO } from '../../dto/response/UserResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const queryParams = event.queryStringParameters || {};

    const params = ListUsersSchema.parse({
      customerId: queryParams.customerId,
      partnerId: queryParams.partnerId,
      type: queryParams.type,
      status: queryParams.status,
      search: queryParams.search,
      limit: queryParams.limit ? parseInt(queryParams.limit, 10) : undefined,
      cursor: queryParams.cursor,
    });

    const result = await userService.list(ctx.tenantId, params);

    return ok({
      items: result.items.map(toUserSummaryDTO),
      pagination: result.pagination,
    });
  } catch (err) {
    return handleError(err);
  }
};
