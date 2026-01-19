import { APIGatewayProxyHandler } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { success } from '../middleware/response';
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

    const partner = await partnerService.getById(ctx.tenantId, id);

    // Remove sensitive data from response
    const response = {
      ...partner,
      apiKeys: partner.apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        status: k.status,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
      })),
    };

    return success(response);
  } catch (err) {
    return handleError(err);
  }
};
