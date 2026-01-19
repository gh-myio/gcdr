import { APIGatewayProxyHandler } from 'aws-lambda';
import { themeService } from '../../services/ThemeService';
import { toThemeSummaryDTO } from '../../dto/response/LookAndFeelResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.customerId;

    if (!customerId) {
      return handleError(new Error('Customer ID is required'));
    }

    const themes = await themeService.listByCustomer(ctx.tenantId, customerId);

    return ok({
      items: themes.map(toThemeSummaryDTO),
    });
  } catch (err) {
    return handleError(err);
  }
};
