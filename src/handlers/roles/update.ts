import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateRoleSchema } from '../../dto/request/AuthorizationDTO';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const roleId = event.pathParameters?.roleId;
    const body = parseBody(event);

    if (!roleId) {
      return handleError(new Error('Role ID is required'));
    }

    const data = UpdateRoleSchema.parse(body);

    const role = await authorizationService.updateRole(ctx.tenantId, roleId, data, ctx.userId);

    return ok(role);
  } catch (err) {
    return handleError(err);
  }
};
