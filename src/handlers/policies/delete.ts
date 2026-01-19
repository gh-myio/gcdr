import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const policyId = event.pathParameters?.policyId;

    if (!policyId) {
      return handleError(new Error('Policy ID is required'));
    }

    await authorizationService.deletePolicy(ctx.tenantId, policyId, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
