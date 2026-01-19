import { APIGatewayProxyHandler } from 'aws-lambda';
import { deviceService } from '../../services/DeviceService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { ListDevicesParams } from '../../dto/request/DeviceDTO';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const queryParams = event.queryStringParameters || {};

    const params: ListDevicesParams = {
      assetId: queryParams.assetId,
      customerId: queryParams.customerId,
      type: queryParams.type,
      status: queryParams.status,
      connectivityStatus: queryParams.connectivityStatus,
      limit: queryParams.limit ? parseInt(queryParams.limit, 10) : undefined,
      cursor: queryParams.cursor,
    };

    const result = await deviceService.list(ctx.tenantId, params);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
