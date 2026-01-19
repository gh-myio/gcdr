import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateConnectivitySchema } from '../../dto/request/DeviceDTO';
import { deviceService } from '../../services/DeviceService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const deviceId = event.pathParameters?.id;

    if (!deviceId) {
      return handleError(new Error('Device ID is required'));
    }

    const body = parseBody(event);
    const data = UpdateConnectivitySchema.parse(body);

    const device = await deviceService.updateConnectivityStatus(
      ctx.tenantId,
      deviceId,
      data.connectivityStatus
    );

    return ok(device);
  } catch (err) {
    return handleError(err);
  }
};
