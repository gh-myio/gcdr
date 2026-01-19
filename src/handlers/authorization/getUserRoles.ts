import { APIGatewayProxyHandler } from 'aws-lambda';
import { success } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parsePathParams } from '../middleware/requestContext';
import { mockRoleAssignments, mockRoles, mockPolicies } from '../../repositories/mockData';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const { userId } = parsePathParams(event);

    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    // Get user's role assignments
    const assignments = Array.from(mockRoleAssignments.values()).filter(
      (a) => a.userId === userId && a.tenantId === ctx.tenantId && a.status === 'active'
    );

    // Enrich with role details
    const enrichedAssignments = assignments.map((assignment) => {
      const role = mockRoles.get(assignment.roleKey);
      const policies = role
        ? role.policies.map((pKey) => mockPolicies.get(pKey)).filter(Boolean)
        : [];

      return {
        ...assignment,
        role: role
          ? {
              key: role.key,
              displayName: role.displayName,
              description: role.description,
              riskLevel: role.riskLevel,
            }
          : null,
        effectivePermissions: policies.flatMap((p) => p!.allow),
      };
    });

    return success({
      userId,
      assignments: enrichedAssignments,
      count: enrichedAssignments.length,
    });
  } catch (err) {
    return handleError(err);
  }
};
