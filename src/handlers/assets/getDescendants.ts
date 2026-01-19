import { APIGatewayProxyHandler } from 'aws-lambda';
import { assetService } from '../../services/AssetService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const assetId = event.pathParameters?.id;

    if (!assetId) {
      return handleError(new Error('Asset ID is required'));
    }

    const queryParams = event.queryStringParameters || {};
    const maxDepth = queryParams.maxDepth ? parseInt(queryParams.maxDepth, 10) : undefined;

    const descendants = await assetService.getDescendants(ctx.tenantId, assetId, { maxDepth });

    return ok({ items: descendants });
  } catch (err) {
    return handleError(err);
  }
};
