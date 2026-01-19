import { APIGatewayProxyHandler } from 'aws-lambda';
import { centralService } from '../../services/CentralService';
import { toCentralDetailDTO } from '../../dto/response/CentralResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const centralId = event.pathParameters?.id;

    if (!centralId) {
      return handleError(new Error('Central ID is required'));
    }

    const central = await centralService.getById(ctx.tenantId, centralId);

    return ok(toCentralDetailDTO(central));
  } catch (err) {
    return handleError(err);
  }
};
