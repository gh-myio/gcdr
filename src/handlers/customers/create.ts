import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateCustomerSchema } from '../../dto/request/CustomerDTO';
import { customerService } from '../../services/CustomerService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    // Validate input
    const data = CreateCustomerSchema.parse(body);

    // Create customer
    const customer = await customerService.create(ctx.tenantId, data, ctx.userId);

    return created(customer);
  } catch (err) {
    return handleError(err);
  }
};
