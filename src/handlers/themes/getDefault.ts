import { APIGatewayProxyHandler } from 'aws-lambda';
import { themeService } from '../../services/ThemeService';
import { toThemeDetailDTO } from '../../dto/response/LookAndFeelResponseDTO';
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

    const theme = await themeService.getDefaultByCustomer(ctx.tenantId, customerId);

    if (!theme) {
      return notFound('No default theme found for this customer');
    }

    return ok(toThemeDetailDTO(theme));
  } catch (err) {
    return handleError(err);
  }
};
