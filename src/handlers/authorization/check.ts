import { APIGatewayProxyHandler } from 'aws-lambda';
import { EvaluatePermissionSchema } from '../../dto/request/AuthorizationDTO';
import { success, error } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { mockRoleAssignments, mockRoles, mockPolicies } from '../../repositories/mockData';

// Simple permission check using mock data - MVP implementation
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    // Validate input
    const data = EvaluatePermissionSchema.parse(body);

    // Get user's role assignments
    const assignments = Array.from(mockRoleAssignments.values()).filter(
      (a) => a.userId === data.userId && a.status === 'active'
    );

    if (assignments.length === 0) {
      return success({
        allowed: false,
        reason: 'No active role assignments found',
        details: { userId: data.userId, permission: data.permission },
      });
    }

    // Check each assignment
    for (const assignment of assignments) {
      // Check scope match
      if (!checkScopeMatch(assignment.scope, data.resourceScope)) {
        continue;
      }

      // Get role
      const role = mockRoles.get(assignment.roleKey);
      if (!role) continue;

      // Check each policy in role
      for (const policyKey of role.policies) {
        const policy = mockPolicies.get(policyKey);
        if (!policy) continue;

        // Check deny first
        if (matchesPattern(data.permission, policy.deny)) {
          return success({
            allowed: false,
            reason: 'Permission explicitly denied by policy',
            details: {
              policy: policyKey,
              role: assignment.roleKey,
            },
          });
        }

        // Check allow
        if (matchesPattern(data.permission, policy.allow)) {
          return success({
            allowed: true,
            reason: 'Permission granted',
            details: {
              policy: policyKey,
              role: assignment.roleKey,
              scope: assignment.scope,
            },
          });
        }
      }
    }

    return success({
      allowed: false,
      reason: 'No matching permission found',
      details: { userId: data.userId, permission: data.permission },
    });
  } catch (err) {
    return handleError(err);
  }
};

function checkScopeMatch(assignmentScope: string, resourceScope: string): boolean {
  // tenant:* matches everything
  if (assignmentScope === 'tenant:*') return true;

  // Exact match
  if (assignmentScope === resourceScope) return true;

  // Hierarchical match: customer:cust-001 should match customer:cust-001 and children
  const [assignmentType, assignmentId] = assignmentScope.split(':');
  const [resourceType, resourceId] = resourceScope.split(':');

  if (assignmentType !== resourceType) return false;

  // For customer scope, check if resource is under the assignment scope
  // This is simplified - full implementation would check the customer hierarchy
  return resourceId.startsWith(assignmentId);
}

function matchesPattern(permission: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === '*.*.*' || pattern === permission) {
      return true;
    }

    const [permDomain, permFunc, permAction] = permission.split('.');
    const [patDomain, patFunc, patAction] = pattern.split('.');

    const domainMatch = patDomain === '*' || patDomain === permDomain;
    const funcMatch = patFunc === '*' || patFunc === permFunc;
    const actionMatch = patAction === '*' || patAction === permAction;

    if (domainMatch && funcMatch && actionMatch) {
      return true;
    }
  }
  return false;
}
