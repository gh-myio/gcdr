import { APIGatewayProxyHandler } from 'aws-lambda';
import { ruleService } from '../../services/RuleService';
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
      type: event.queryStringParameters?.type as any,
      priority: event.queryStringParameters?.priority as any,
      customerId: event.queryStringParameters?.customerId,
      enabled: event.queryStringParameters?.enabled === 'true'
        ? true
        : event.queryStringParameters?.enabled === 'false'
        ? false
        : undefined,
      status: event.queryStringParameters?.status as any,
    };

    const result = await ruleService.list(ctx.tenantId, params);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
