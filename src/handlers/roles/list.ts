import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);

    const params = {
      limit: event.queryStringParameters?.limit
        ? parseInt(event.queryStringParameters.limit, 10)
        : undefined,
      cursor: event.queryStringParameters?.cursor,
      riskLevel: event.queryStringParameters?.riskLevel,
      isSystem: event.queryStringParameters?.isSystem === 'true'
        ? true
        : event.queryStringParameters?.isSystem === 'false'
        ? false
        : undefined,
    };

    const result = await authorizationService.listRoles(ctx.tenantId, params);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
