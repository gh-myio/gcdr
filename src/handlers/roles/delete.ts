import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const roleId = event.pathParameters?.roleId;

    if (!roleId) {
      return handleError(new Error('Role ID is required'));
    }

    await authorizationService.deleteRole(ctx.tenantId, roleId, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
