import { APIGatewayProxyHandler } from 'aws-lambda';
import { toPackageDetailDTO } from '../../dto/response/IntegrationResponseDTO';
import { integrationService } from '../../services/IntegrationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);

    if (!id) {
      throw new ValidationError('Package ID is required');
    }

    const pkg = await integrationService.getPackageById(ctx.tenantId, id);

    return ok(toPackageDetailDTO(pkg));
  } catch (err) {
    return handleError(err);
  }
};
