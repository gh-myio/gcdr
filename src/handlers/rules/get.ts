import { APIGatewayProxyHandler } from 'aws-lambda';
import { ruleService } from '../../services/RuleService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const ruleId = event.pathParameters?.id;

    if (!ruleId) {
      return handleError(new Error('Rule ID is required'));
    }

    const rule = await ruleService.getById(ctx.tenantId, ruleId);

    return ok(rule);
  } catch (err) {
    return handleError(err);
  }
};
