import { APIGatewayProxyHandler } from 'aws-lambda';
import { ListCentralsSchema } from '../../dto/request/CentralDTO';
import { centralService } from '../../services/CentralService';
import { toCentralSummaryDTO } from '../../dto/response/CentralResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const queryParams = event.queryStringParameters || {};

    const params = ListCentralsSchema.parse({
      customerId: queryParams.customerId,
      assetId: queryParams.assetId,
      type: queryParams.type,
      status: queryParams.status,
      connectionStatus: queryParams.connectionStatus,
      limit: queryParams.limit ? parseInt(queryParams.limit, 10) : undefined,
      cursor: queryParams.cursor,
    });

    const result = await centralService.list(ctx.tenantId, params);

    return ok({
      items: result.items.map(toCentralSummaryDTO),
      pagination: result.pagination,
    });
  } catch (err) {
    return handleError(err);
  }
};
