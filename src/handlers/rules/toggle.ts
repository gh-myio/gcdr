import { APIGatewayProxyHandler } from 'aws-lambda';
import { ToggleRuleSchema } from '../../dto/request/RuleDTO';
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

    const data = ToggleRuleSchema.parse(body);

    const rule = await ruleService.toggle(ctx.tenantId, ruleId, data.enabled, ctx.userId, data.reason);

    return ok(rule);
  } catch (err) {
    return handleError(err);
  }
};
