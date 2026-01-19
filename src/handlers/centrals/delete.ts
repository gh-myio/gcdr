import { APIGatewayProxyHandler } from 'aws-lambda';
import { centralService } from '../../services/CentralService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const centralId = event.pathParameters?.id;

    if (!centralId) {
      return handleError(new Error('Central ID is required'));
    }

    await centralService.delete(ctx.tenantId, centralId, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
