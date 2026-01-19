import { APIGatewayProxyHandler } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id, keyId } = parsePathParams(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    if (!keyId) {
      throw new ValidationError('API key ID is required');
    }

    const { partner, newApiKey } = await partnerService.rotateApiKey(ctx.tenantId, id, keyId, ctx.userId);

    const newKey = partner.apiKeys.find((k) => k.keyPrefix === newApiKey.substring(0, 8));

    return ok({
      message: 'API key rotated successfully. Store this key securely - it will not be shown again.',
      apiKey: {
        id: newKey?.id,
        key: newApiKey,
        name: newKey?.name,
        scopes: newKey?.scopes,
        expiresAt: newKey?.expiresAt || null,
        createdAt: newKey?.createdAt,
      },
      previousKeyId: keyId,
    });
  } catch (err) {
    return handleError(err);
  }
};
