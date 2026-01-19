import { APIGatewayProxyHandler } from 'aws-lambda';
import { integrationService } from '../../services/IntegrationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { subscriptionId } = parsePathParams(event);

    if (!subscriptionId) {
      throw new ValidationError('Subscription ID is required');
    }

    await integrationService.unsubscribe(ctx.tenantId, subscriptionId, ctx.userId);

    return ok({
      message: 'Successfully unsubscribed from package',
    });
  } catch (err) {
    return handleError(err);
  }
};
