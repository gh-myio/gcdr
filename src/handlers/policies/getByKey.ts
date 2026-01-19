import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const policyKey = event.pathParameters?.policyKey;

    if (!policyKey) {
      return handleError(new Error('Policy key is required'));
    }

    const policy = await authorizationService.getPolicyByKey(ctx.tenantId, policyKey);

    return ok(policy);
  } catch (err) {
    return handleError(err);
  }
};
