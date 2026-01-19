import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateCentralSchema } from '../../dto/request/CentralDTO';
import { centralService } from '../../services/CentralService';
import { toCentralDetailDTO } from '../../dto/response/CentralResponseDTO';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = CreateCentralSchema.parse(body);
    const central = await centralService.create(ctx.tenantId, data, ctx.userId);

    return created(toCentralDetailDTO(central));
  } catch (err) {
    return handleError(err);
  }
};
