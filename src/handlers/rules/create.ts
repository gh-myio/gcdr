import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateRuleSchema } from '../../dto/request/RuleDTO';
import { ruleService } from '../../services/RuleService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = CreateRuleSchema.parse(body);

    const rule = await ruleService.create(ctx.tenantId, data, ctx.userId);

    return created(rule);
  } catch (err) {
    return handleError(err);
  }
};
