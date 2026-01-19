import { APIGatewayProxyHandler } from 'aws-lambda';
import { assetService } from '../../services/AssetService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const assetId = event.pathParameters?.id;

    if (!assetId) {
      return handleError(new Error('Asset ID is required'));
    }

    await assetService.delete(ctx.tenantId, assetId, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
