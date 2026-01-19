import { APIGatewayProxyHandler } from 'aws-lambda';
import { centralService } from '../../services/CentralService';
import { toCentralSummaryDTO } from '../../dto/response/CentralResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const assetId = event.pathParameters?.assetId;

    if (!assetId) {
      return handleError(new Error('Asset ID is required'));
    }

    const centrals = await centralService.listByAsset(ctx.tenantId, assetId);

    return ok({
      items: centrals.map(toCentralSummaryDTO),
    });
  } catch (err) {
    return handleError(err);
  }
};
