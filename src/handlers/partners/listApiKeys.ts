import { APIGatewayProxyHandler } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams, parseQueryParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id } = parsePathParams(event);
    const query = parseQueryParams(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    const partner = await partnerService.getById(ctx.tenantId, id);

    // Filter by status if provided
    const statusFilter = query.status as string | undefined;
    let apiKeys = partner.apiKeys;

    if (statusFilter) {
      apiKeys = apiKeys.filter((k) => k.status === statusFilter.toUpperCase());
    }

    return ok({
      items: apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        status: k.status,
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
      })),
      count: apiKeys.length,
      total: partner.apiKeys.length,
    });
  } catch (err) {
    return handleError(err);
  }
};
