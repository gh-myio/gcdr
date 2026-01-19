import { APIGatewayProxyHandler } from 'aws-lambda';
import { themeService } from '../../services/ThemeService';
import { noContent } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const themeId = event.pathParameters?.id;

    if (!themeId) {
      return handleError(new Error('Theme ID is required'));
    }

    await themeService.delete(ctx.tenantId, themeId, ctx.userId);

    return noContent();
  } catch (err) {
    return handleError(err);
  }
};
