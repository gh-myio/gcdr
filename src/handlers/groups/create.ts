import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateGroupSchema } from '../../dto/request/GroupDTO';
import { groupService } from '../../services/GroupService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

/**
 * POST /customers/{id}/groups
 * Create a new group for a customer
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;

    if (!customerId) {
      throw new ValidationError('Customer ID is required');
    }

    const body = parseBody(event);
    const data = CreateGroupSchema.parse(body);

    const group = await groupService.createGroup(ctx.tenantId, customerId, data, ctx.userId);

    return created(group);
  } catch (err) {
    return handleError(err);
  }
};
