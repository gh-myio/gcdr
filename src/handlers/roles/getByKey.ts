import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const roleKey = event.pathParameters?.roleKey;

    if (!roleKey) {
      return handleError(new Error('Role key is required'));
    }

    const role = await authorizationService.getRoleByKey(ctx.tenantId, roleKey);

    return ok(role);
  } catch (err) {
    return handleError(err);
  }
};
