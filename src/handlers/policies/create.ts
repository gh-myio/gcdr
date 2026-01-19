import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreatePolicySchema } from '../../dto/request/AuthorizationDTO';
import { authorizationService } from '../../services/AuthorizationService';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = CreatePolicySchema.parse(body);

    const policy = await authorizationService.createPolicy(ctx.tenantId, data, ctx.userId);

    return created(policy);
  } catch (err) {
    return handleError(err);
  }
};
