import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateAssetSchema } from '../../dto/request/AssetDTO';
import { assetService } from '../../services/AssetService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    // Validate input
    const data = CreateAssetSchema.parse(body);

    // Create asset
    const asset = await assetService.create(ctx.tenantId, data, ctx.userId);

    return created(asset);
  } catch (err) {
    return handleError(err);
  }
};
