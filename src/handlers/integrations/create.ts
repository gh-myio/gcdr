import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreatePackageSchema } from '../../dto/request/IntegrationDTO';
import { toPackageDetailDTO } from '../../dto/response/IntegrationResponseDTO';
import { integrationService } from '../../services/IntegrationService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = CreatePackageSchema.parse(body);

    const pkg = await integrationService.createPackage(ctx.tenantId, data, ctx.userId);

    return created(toPackageDetailDTO(pkg));
  } catch (err) {
    return handleError(err);
  }
};
