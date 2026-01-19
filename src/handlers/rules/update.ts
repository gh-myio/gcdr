import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateRuleSchema } from '../../dto/request/RuleDTO';
import { ruleService } from '../../services/RuleService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const ruleId = event.pathParameters?.id;
    const body = parseBody(event);

    if (!ruleId) {
      return handleError(new Error('Rule ID is required'));
    }

    const data = UpdateRuleSchema.parse(body);

    const rule = await ruleService.update(ctx.tenantId, ruleId, data, ctx.userId);

    return ok(rule);
  } catch (err) {
    return handleError(err);
  }
};
