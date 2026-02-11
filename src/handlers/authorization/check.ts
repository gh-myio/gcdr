import { APIGatewayProxyHandler } from 'aws-lambda';
import { EvaluatePermissionSchema } from '../../dto/request/AuthorizationDTO';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = EvaluatePermissionSchema.parse(body);

    const result = await authorizationService.evaluatePermission(ctx.tenantId, data);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
