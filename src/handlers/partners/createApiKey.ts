import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateApiKeySchema } from '../../dto/request/PartnerDTO';
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

    const data = CreateApiKeySchema.parse(body);

    const { partner, apiKey } = await partnerService.createApiKey(ctx.tenantId, id, data, ctx.userId);

    const createdKey = partner.apiKeys.find((k) => k.name === data.name);

    return created({
      message: 'API key created successfully. Store this key securely - it will not be shown again.',
      apiKey: {
        id: createdKey?.id,
        key: apiKey,
        name: data.name,
        scopes: data.scopes,
        expiresAt: data.expiresAt || null,
        createdAt: createdKey?.createdAt,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
