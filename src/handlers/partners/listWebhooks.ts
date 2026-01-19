import { APIGatewayProxyHandler } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const webhooks = await partnerService.listWebhooks(ctx.tenantId, id);

    return ok({
      items: webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        enabled: w.enabled,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        lastDeliveryAt: w.lastDeliveryAt,
        lastDeliveryStatus: w.lastDeliveryStatus,
        failureCount: w.failureCount,
      })),
      count: webhooks.length,
    });
  } catch (err) {
    return handleError(err);
  }
};
