import { APIGatewayProxyHandler } from 'aws-lambda';
import { assetService } from '../../services/AssetService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const assetId = event.pathParameters?.id;
    const queryParams = event.queryStringParameters || {};
    const customerId = queryParams.customerId;

    const tree = await assetService.getTree(ctx.tenantId, customerId, assetId || undefined);

    return ok({ tree });
  } catch (err) {
    return handleError(err);
  }
};
