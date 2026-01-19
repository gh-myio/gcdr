import { APIGatewayProxyHandler } from 'aws-lambda';
import { themeService } from '../../services/ThemeService';
import { toThemeDetailDTO } from '../../dto/response/LookAndFeelResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const themeId = event.pathParameters?.id;

    if (!themeId) {
      return handleError(new Error('Theme ID is required'));
    }

    const theme = await themeService.getById(ctx.tenantId, themeId);

    return ok(toThemeDetailDTO(theme));
  } catch (err) {
    return handleError(err);
  }
};
