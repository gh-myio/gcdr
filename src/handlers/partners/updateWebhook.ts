import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateWebhookSchema } from '../../dto/request/PartnerDTO';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id, webhookId } = parsePathParams(event);
    const body = parseBody(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    if (!webhookId) {
      throw new ValidationError('Webhook ID is required');
    }

    const data = UpdateWebhookSchema.parse(body);

    const partner = await partnerService.updateWebhook(ctx.tenantId, id, webhookId, data, ctx.userId);

    const updatedWebhook = partner.webhooks.find((w) => w.id === webhookId);

    return ok({
      message: 'Webhook updated successfully',
      webhook: {
        id: webhookId,
        url: updatedWebhook?.url,
        events: updatedWebhook?.events,
        enabled: updatedWebhook?.enabled,
        updatedAt: updatedWebhook?.updatedAt,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
