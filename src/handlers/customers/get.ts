import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerService } from '../../services/CustomerService';
import { success } from '../middleware/response';
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

    const customer = await customerService.getById(ctx.tenantId, id);

    return success(customer);
  } catch (err) {
    return handleError(err);
  }
};
