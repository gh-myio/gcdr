import { APIGatewayProxyHandler } from 'aws-lambda';
import { ReviewPackageSchema } from '../../dto/request/IntegrationDTO';
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

    const data = ReviewPackageSchema.parse(body);

    const pkg = await integrationService.reviewPackage(ctx.tenantId, id, data, ctx.userId);

    return ok({
      message: data.approved ? 'Package approved and published' : 'Package rejected',
      package: toPackageDetailDTO(pkg),
    });
  } catch (err) {
    return handleError(err);
  }
};
