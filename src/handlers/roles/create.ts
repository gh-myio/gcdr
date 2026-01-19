import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateRoleSchema } from '../../dto/request/AuthorizationDTO';
import { authorizationService } from '../../services/AuthorizationService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = CreateRoleSchema.parse(body);

    const role = await authorizationService.createRole(ctx.tenantId, data, ctx.userId);

    return created(role);
  } catch (err) {
    return handleError(err);
  }
};
