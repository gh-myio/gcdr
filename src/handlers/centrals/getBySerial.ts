import { APIGatewayProxyHandler } from 'aws-lambda';
import { centralService } from '../../services/CentralService';
import { toCentralDetailDTO } from '../../dto/response/CentralResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const serialNumber = event.pathParameters?.serialNumber;

    if (!serialNumber) {
      return handleError(new Error('Serial number is required'));
    }

    const central = await centralService.getBySerialNumber(ctx.tenantId, serialNumber);

    return ok(toCentralDetailDTO(central));
  } catch (err) {
    return handleError(err);
  }
};
