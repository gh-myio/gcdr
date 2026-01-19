import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateWebhookSchema } from '../../dto/request/PartnerDTO';
import { partnerService } from '../../services/PartnerService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);
    const body = parseBody(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const data = CreateWebhookSchema.parse(body);

    const { webhook, secret } = await partnerService.createWebhook(ctx.tenantId, id, data, ctx.userId);

    const response: Record<string, unknown> = {
      message: 'Webhook created successfully',
      webhook: {
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        enabled: webhook.enabled,
        createdAt: webhook.createdAt,
      },
    };

    if (secret) {
      response.message =
        'Webhook created successfully. Store the secret securely - it will not be shown again.';
      response.secret = secret;
    }

    return created(response);
  } catch (err) {
    return handleError(err);
  }
};
