import { APIGatewayProxyHandler } from 'aws-lambda';
import { EvaluateRuleSchema } from '../../dto/request/RuleDTO';
import { ruleService } from '../../services/RuleService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = EvaluateRuleSchema.parse(body);

    const result = await ruleService.evaluate(ctx.tenantId, data.ruleId, data.sampleData);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
