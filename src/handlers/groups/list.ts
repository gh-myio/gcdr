import { APIGatewayProxyHandler } from 'aws-lambda';
import { ListGroupsQuerySchema } from '../../dto/request/GroupDTO';
import { groupService } from '../../services/GroupService';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

/**
 * GET /groups
 * List all groups with filters
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const queryParams = event.queryStringParameters || {};

    const params = ListGroupsQuerySchema.parse(queryParams);

    const result = await groupService.listGroups(ctx.tenantId, params);

    return ok(result);
  } catch (err) {
    return handleError(err);
  }
};
