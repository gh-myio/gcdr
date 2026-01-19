import { APIGatewayProxyHandler } from 'aws-lambda';
import { MoveDeviceSchema } from '../../dto/request/DeviceDTO';
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
    const data = MoveDeviceSchema.parse(body);

    const device = await deviceService.move(ctx.tenantId, deviceId, data, ctx.userId);

    return ok(device);
  } catch (err) {
    return handleError(err);
  }
};
