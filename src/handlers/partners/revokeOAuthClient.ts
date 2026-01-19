import { APIGatewayProxyHandler } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { id, clientId } = parsePathParams(event);

    if (!id) {
      throw new ValidationError('Partner ID is required');
    }

    if (!clientId) {
      throw new ValidationError('OAuth client ID is required');
    }

    const partner = await partnerService.revokeOAuthClient(ctx.tenantId, id, clientId, ctx.userId);

    const revokedClient = partner.oauthClients.find((c) => c.clientId === clientId);

    return ok({
      message: 'OAuth client revoked successfully',
      client: {
        clientId,
        name: revokedClient?.name,
        status: 'REVOKED',
        revokedAt: revokedClient?.revokedAt,
      },
    });
  } catch (err) {
    return handleError(err);
  }
};
