import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const assignmentId = event.pathParameters?.assignmentId;

    if (!assignmentId) {
      return handleError(new Error('Assignment ID is required'));
    }

    const assignment = await authorizationService.revokeAssignment(
      ctx.tenantId,
      assignmentId,
      ctx.userId
    );

    return ok(assignment);
  } catch (err) {
    return handleError(err);
  }
};
