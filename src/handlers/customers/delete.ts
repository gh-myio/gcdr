import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerService } from '../../services/CustomerService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);

    if (!id) {
      throw new ValidationError('Customer ID is required');
    }

    await customerService.delete(ctx.tenantId, id, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
