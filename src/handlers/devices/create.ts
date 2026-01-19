import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateDeviceSchema } from '../../dto/request/DeviceDTO';
import { deviceService } from '../../services/DeviceService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    // Validate input
    const data = CreateDeviceSchema.parse(body);

    // Create device
    const device = await deviceService.create(ctx.tenantId, data, ctx.userId);

    return created(device);
  } catch (err) {
    return handleError(err);
  }
};
