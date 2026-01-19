import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateAssetSchema } from '../../dto/request/AssetDTO';
import { assetService } from '../../services/AssetService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const assetId = event.pathParameters?.id;

    if (!assetId) {
      return handleError(new Error('Asset ID is required'));
    }

    const body = parseBody(event);
    const data = UpdateAssetSchema.parse(body);

    const asset = await assetService.update(ctx.tenantId, assetId, data, ctx.userId);

    return ok(asset);
  } catch (err) {
    return handleError(err);
  }
};
