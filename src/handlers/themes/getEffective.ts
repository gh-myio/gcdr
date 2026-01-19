import { APIGatewayProxyHandler } from 'aws-lambda';
import { themeService } from '../../services/ThemeService';
import { ok, notFound } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.customerId;

    if (!customerId) {
      return handleError(new Error('Customer ID is required'));
    }

    const effectiveTheme = await themeService.getEffectiveTheme(ctx.tenantId, customerId);

    if (!effectiveTheme) {
      return notFound('No theme configured for this customer');
    }

    return ok(effectiveTheme);
  } catch (err) {
    return handleError(err);
  }
};
