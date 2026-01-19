import { APIGatewayProxyHandler } from 'aws-lambda';
import { assetService } from '../../services/AssetService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ListAssetsParams } from '../../dto/request/AssetDTO';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.customerId;

    if (!customerId) {
      return handleError(new Error('Customer ID is required'));
    }

    const queryParams = event.queryStringParameters || {};

    const params: ListAssetsParams = {
      type: queryParams.type,
      status: queryParams.status,
      limit: queryParams.limit ? parseInt(queryParams.limit, 10) : undefined,
      cursor: queryParams.cursor,
    };

    const result = await assetService.listByCustomer(ctx.tenantId, customerId, params);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
