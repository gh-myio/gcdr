import { APIGatewayProxyHandler } from 'aws-lambda';
import { customerService } from '../../services/CustomerService';
import { success } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseQueryParams } from '../middleware/requestContext';
import { ListCustomersParams } from '../../dto/request/CustomerDTO';
import { CustomerType, EntityStatus } from '../../shared/types';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const query = parseQueryParams(event);

    const params: ListCustomersParams = {
      limit: query.limit ? parseInt(query.limit, 10) : 20,
      cursor: query.cursor,
      type: query.type as CustomerType | undefined,
      status: query.status as 'ACTIVE' | 'INACTIVE' | undefined,
      parentCustomerId: query.parentCustomerId === 'null' ? null : query.parentCustomerId,
    };

    const result = await customerService.list(ctx.tenantId, params);

    return success(result);
  } catch (err) {
    return handleError(err);
  }
};
