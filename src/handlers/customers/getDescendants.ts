import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerService } from '../../services/CustomerService';
import { success } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams, parseQueryParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);
    const query = parseQueryParams(event);

    if (!id) {
      throw new ValidationError('Customer ID is required');
    }

    const params = {
      maxDepth: query.maxDepth ? parseInt(query.maxDepth, 10) : undefined,
    };

    const descendants = await customerService.getDescendants(ctx.tenantId, id, params);

    return success({ items: descendants, count: descendants.length });
  } catch (err) {
    return handleError(err);
  }
};
