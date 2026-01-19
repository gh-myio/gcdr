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

    const partner = await partnerService.revokeApiKey(ctx.tenantId, id, keyId, ctx.userId);

    const revokedKey = partner.apiKeys.find((k) => k.id === keyId);

    return ok({
      message: 'API key revoked successfully',
      apiKey: {
        id: keyId,
        name: revokedKey?.name,
        status: 'REVOKED',
        revokedAt: revokedKey?.revokedAt,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
