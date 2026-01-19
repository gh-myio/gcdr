import { APIGatewayProxyHandler } from 'aws-lambda';
import { SearchPackagesSchema } from '../../dto/request/IntegrationDTO';
import { toPackageSummaryDTO } from '../../dto/response/IntegrationResponseDTO';
import { integrationService } from '../../services/IntegrationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseQueryParams } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const query = parseQueryParams(event);

    // Parse query params
    const params = SearchPackagesSchema.parse({
      query: query.query,
      category: query.category,
      type: query.type,
      status: query.status,
      pricing: query.pricing,
      verified: query.verified === 'true' ? true : query.verified === 'false' ? false : undefined,
      tags: query.tags ? (query.tags as string).split(',') : undefined,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      limit: query.limit ? parseInt(query.limit as string, 10) : undefined,
      cursor: query.cursor,
    });

    const result = await integrationService.searchPackages(ctx.tenantId, params);

    return ok({
      items: result.items.map(toPackageSummaryDTO),
      pagination: result.pagination,
    });
  } catch (err) {
    return handleError(err);
  }
};
