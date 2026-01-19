import { APIGatewayProxyHandler } from 'aws-lambda';
import { RegisterPartnerSchema } from '../../dto/request/PartnerDTO';
import { partnerService } from '../../services/PartnerService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    // Validate input
    const data = RegisterPartnerSchema.parse(body);

    // Register partner
    const partner = await partnerService.register(ctx.tenantId, data, ctx.userId);

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
      })),
    };

    return created(response);
  } catch (err) {
    return handleError(err);
  }
};
