import { APIGatewayProxyHandler } from 'aws-lambda';
import { success } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';
import { mockRoles } from '../../repositories/mockData';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);

    // Return roles from mock data - will be replaced with repository
    const roles = Array.from(mockRoles.values()).filter(
      (role) => role.tenantId === ctx.tenantId
    );

    return success({
      items: roles,
      count: roles.length,
    });
  } catch (err) {
    return handleError(err);
  }
};
