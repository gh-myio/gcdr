import { APIGatewayProxyHandler } from 'aws-lambda';
import { themeService } from '../../services/ThemeService';
import { toThemeDetailDTO } from '../../dto/response/LookAndFeelResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const customerId = event.pathParameters?.id;
    const themeId = event.pathParameters?.themeId;

    if (!customerId) {
      return handleError(new Error('Customer ID is required'));
    }

    if (!themeId) {
      return handleError(new Error('Theme ID is required'));
    }

    const theme = await themeService.setDefault(ctx.tenantId, customerId, themeId, ctx.userId);

    return ok(toThemeDetailDTO(theme));
  } catch (err) {
    return handleError(err);
  }
};
