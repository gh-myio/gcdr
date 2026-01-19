import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateCentralSchema } from '../../dto/request/CentralDTO';
import { centralService } from '../../services/CentralService';
import { toCentralDetailDTO } from '../../dto/response/CentralResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const centralId = event.pathParameters?.id;

    if (!centralId) {
      return handleError(new Error('Central ID is required'));
    }

    const body = parseBody(event);
    const data = UpdateCentralSchema.parse(body);

    const central = await centralService.update(ctx.tenantId, centralId, data, ctx.userId);

    return ok(toCentralDetailDTO(central));
  } catch (err) {
    return handleError(err);
  }
};
