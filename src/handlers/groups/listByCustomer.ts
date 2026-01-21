import { APIGatewayProxyHandler } from 'aws-lambda';
import { ListGroupsQuerySchema } from '../../dto/request/GroupDTO';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * GET /customers/{id}/groups
 * List groups for a specific customer
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const queryParams = event.queryStringParameters || {};
    const params = ListGroupsQuerySchema.parse(queryParams);

    const result = await groupService.listGroupsByCustomer(ctx.tenantId, customerId, params);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
