import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const roleId = event.pathParameters?.roleId;

    if (!roleId) {
      return handleError(new Error('Role ID is required'));
    }

    const role = await authorizationService.getRoleById(ctx.tenantId, roleId);

    return ok(role);
  } catch (err) {
    return handleError(err);
  }
};
