import { APIGatewayProxyHandler } from 'aws-lambda';
import { ruleService } from '../../services/RuleService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const ruleId = event.pathParameters?.id;

    if (!ruleId) {
      return handleError(new Error('Rule ID is required'));
    }

    await ruleService.delete(ctx.tenantId, ruleId, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
