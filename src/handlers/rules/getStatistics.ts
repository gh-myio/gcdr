import { APIGatewayProxyHandler } from 'aws-lambda';
import { ruleService } from '../../services/RuleService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);

    const statistics = await ruleService.getStatistics(ctx.tenantId);

    return ok(statistics);
  } catch (err) {
    return handleError(err);
  }
};
