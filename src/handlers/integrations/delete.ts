import { APIGatewayProxyHandler } from 'aws-lambda';
import { integrationService } from '../../services/IntegrationService';
import { noContent } from '../middleware/response';
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

    await integrationService.deletePackage(ctx.tenantId, id, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
