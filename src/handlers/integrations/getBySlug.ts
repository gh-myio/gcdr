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
    const { slug } = parsePathParams(event);

    if (!slug) {
      throw new ValidationError('Package slug is required');
    }

    const pkg = await integrationService.getPackageBySlug(ctx.tenantId, slug);

    return ok(toPackageDetailDTO(pkg));
  } catch (err) {
    return handleError(err);
  }
};
