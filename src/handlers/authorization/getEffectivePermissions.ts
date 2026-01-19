import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const userId = event.pathParameters?.userId;
    const scope = event.queryStringParameters?.scope;

    if (!userId) {
      return handleError(new Error('User ID is required'));
    }

    const permissions = await authorizationService.getEffectivePermissions(
      ctx.tenantId,
      userId,
      scope
    );

    // Get user assignments for response
    const assignments = await authorizationService.getUserAssignments(ctx.tenantId, userId);

    return ok({
      userId,
      scope: scope || '*',
      effectivePermissions: permissions.filter((p) => p.allowed).map((p) => p.permission),
      deniedPatterns: permissions.filter((p) => !p.allowed).map((p) => p.permission),
      roles: assignments.map((a) => ({
        roleKey: a.roleKey,
        scope: a.scope,
        grantedAt: a.grantedAt,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
};
