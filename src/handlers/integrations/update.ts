import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdatePackageSchema } from '../../dto/request/IntegrationDTO';
import { toPackageDetailDTO } from '../../dto/response/IntegrationResponseDTO';
import { integrationService } from '../../services/IntegrationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);
    const body = parseBody(event);

    if (!id) {
      throw new ValidationError('Package ID is required');
    }

    const data = UpdatePackageSchema.parse(body);

    const pkg = await integrationService.updatePackage(ctx.tenantId, id, data, ctx.userId);

    return ok(toPackageDetailDTO(pkg));
  } catch (err) {
    return handleError(err);
  }
};
