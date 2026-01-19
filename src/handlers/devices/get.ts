import { APIGatewayProxyHandler } from 'aws-lambda';
import { deviceService } from '../../services/DeviceService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const deviceId = event.pathParameters?.id;

    if (!deviceId) {
      return handleError(new Error('Device ID is required'));
    }

    const device = await deviceService.getById(ctx.tenantId, deviceId);

    return ok(device);
  } catch (err) {
    return handleError(err);
  }
};
