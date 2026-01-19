import { APIGatewayProxyHandler } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id, webhookId } = parsePathParams(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    if (!webhookId) {
      throw new ValidationError('Webhook ID is required');
    }

    await partnerService.deleteWebhook(ctx.tenantId, id, webhookId, ctx.userId);

    return ok({
      message: 'Webhook deleted successfully',
      webhookId,
    });
  } catch (err) {
    return handleError(err);
  }
};
