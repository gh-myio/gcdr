import { APIGatewayProxyHandler } from 'aws-lambda';
import { ruleService } from '../../services/RuleService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;

    if (!customerId) {
      return handleError(new Error('Customer ID is required'));
    }

    const rules = await ruleService.getByCustomerId(ctx.tenantId, customerId);

    return ok({ items: rules, count: rules.length });
  } catch (err) {
    return handleError(err);
  }
};
