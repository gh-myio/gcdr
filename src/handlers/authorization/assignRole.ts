import { APIGatewayProxyHandler } from 'aws-lambda';
import { AssignRoleSchema } from '../../dto/request/AuthorizationDTO';
import { created, error } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';
import { mockRoles, mockRoleAssignments } from '../../repositories/mockData';
import { generateId } from '../../shared/utils/idGenerator';
import { now } from '../../shared/utils/dateUtils';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    // Validate input
    const data = AssignRoleSchema.parse(body);

    // Validate role exists
    const role = mockRoles.get(data.roleKey);
    if (!role) {
      throw new ValidationError(`Role ${data.roleKey} not found`);
    }

    // Check for existing assignment
    const existingAssignment = Array.from(mockRoleAssignments.values()).find(
      (a) =>
        a.userId === data.userId &&
        a.roleKey === data.roleKey &&
        a.scope === data.scope &&
        a.status === 'active'
    );

    if (existingAssignment) {
      throw new ValidationError('Role already assigned to user with same scope');
    }

    // Create assignment
    const assignmentId = generateId();
    const timestamp = now();

    const assignment = {
      id: assignmentId,
      tenantId: ctx.tenantId,
      userId: data.userId,
      roleKey: data.roleKey,
      scope: data.scope,
      status: 'active' as const,
      grantedBy: ctx.userId,
      grantedAt: timestamp,
      expiresAt: data.expiresAt,
      reason: data.reason,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // In MVP, store in memory (will be replaced with DynamoDB)
    mockRoleAssignments.set(assignmentId, assignment);

    return created(assignment);
  } catch (err) {
    return handleError(err);
  }
};
