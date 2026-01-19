import { APIGatewayProxyHandler } from 'aws-lambda';
import { deviceService } from '../../services/DeviceService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const deviceId = event.pathParameters?.id;

    if (!deviceId) {
      return handleError(new Error('Device ID is required'));
    }

    await deviceService.delete(ctx.tenantId, deviceId, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
