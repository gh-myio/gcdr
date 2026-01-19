import { APIGatewayProxyHandler } from 'aws-lambda';
import { authorizationService } from '../../services/AuthorizationService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { userId } = parsePathParams(event);

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const assignments = await authorizationService.getUserAssignments(ctx.tenantId, userId);
    const effectivePermissions = await authorizationService.getEffectivePermissions(ctx.tenantId, userId);

    return ok({
      userId,
      assignments: assignments.map((a) => ({
        id: a.id,
        roleKey: a.roleKey,
        scope: a.scope,
        status: a.status,
        grantedAt: a.grantedAt,
        grantedBy: a.grantedBy,
        expiresAt: a.expiresAt,
      })),
      effectivePermissions: effectivePermissions.filter((p) => p.allowed).map((p) => p.permission),
      deniedPatterns: effectivePermissions.filter((p) => !p.allowed).map((p) => p.permission),
      count: assignments.length,
    });
  } catch (err) {
    return handleError(err);
  }
};
