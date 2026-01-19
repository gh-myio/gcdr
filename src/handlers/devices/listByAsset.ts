import { APIGatewayProxyHandler } from 'aws-lambda';
import { deviceService } from '../../services/DeviceService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ListDevicesParams } from '../../dto/request/DeviceDTO';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const assetId = event.pathParameters?.assetId;

    if (!assetId) {
      return handleError(new Error('Asset ID is required'));
    }

    const queryParams = event.queryStringParameters || {};

    const params: ListDevicesParams = {
      type: queryParams.type,
      status: queryParams.status,
      connectivityStatus: queryParams.connectivityStatus,
      limit: queryParams.limit ? parseInt(queryParams.limit, 10) : undefined,
      cursor: queryParams.cursor,
    };

    const result = await deviceService.listByAsset(ctx.tenantId, assetId, params);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
