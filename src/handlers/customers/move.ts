import { APIGatewayProxyHandler } from 'aws-lambda';
import { MoveCustomerSchema } from '../../dto/request/CustomerDTO';
import { customerService } from '../../services/CustomerService';
import { success } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);
    const body = parseBody(event);

    if (!id) {
      throw new ValidationError('Customer ID is required');
    }

    // Validate input
    const data = MoveCustomerSchema.parse(body);

    // Move customer
    const customer = await customerService.move(ctx.tenantId, id, data, ctx.userId);

    return success(customer);
  } catch (err) {
    return handleError(err);
  }
};
