import { APIGatewayProxyHandler } from 'aws-lambda';
import { partnerService } from '../../services/PartnerService';
import { success } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseQueryParams } from '../middleware/requestContext';
import { PartnerStatus } from '../../shared/types';
import { ListPartnersParams } from '../../repositories/interfaces/IPartnerRepository';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const query = parseQueryParams(event);

    const params: ListPartnersParams = {
      limit: query.limit ? parseInt(query.limit, 10) : 20,
      cursor: query.cursor,
      status: query.status as PartnerStatus | undefined,
    };

    const result = await partnerService.list(ctx.tenantId, params);

    // Remove sensitive data from response
    const sanitizedItems = result.items.map((partner) => ({
      ...partner,
      apiKeys: partner.apiKeys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        status: k.status,
        createdAt: k.createdAt,
      })),
    }));

    return success({
      ...result,
      items: sanitizedItems,
    });
  } catch (err) {
    return handleError(err);
  }
};
