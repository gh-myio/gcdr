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

    const statusFilter = query.status as string | undefined;
    let oauthClients = partner.oauthClients;

    if (statusFilter) {
      oauthClients = oauthClients.filter((c) => c.status === statusFilter.toUpperCase());
    }

    return ok({
      items: oauthClients.map((c) => ({
        clientId: c.clientId,
        name: c.name,
        scopes: c.scopes,
        grantTypes: c.grantTypes,
        redirectUris: c.redirectUris,
        status: c.status,
        createdAt: c.createdAt,
        revokedAt: c.revokedAt,
      })),
      count: oauthClients.length,
      total: partner.oauthClients.length,
    });
  } catch (err) {
    return handleError(err);
  }
};
