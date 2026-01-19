import { APIGatewayProxyHandler } from 'aws-lambda';
import { UpdateLookAndFeelSchema } from '../../dto/request/LookAndFeelDTO';
import { themeService } from '../../services/ThemeService';
import { toThemeDetailDTO } from '../../dto/response/LookAndFeelResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const themeId = event.pathParameters?.id;

    if (!themeId) {
      return handleError(new Error('Theme ID is required'));
    }

    const body = parseBody(event);
    const data = UpdateLookAndFeelSchema.parse(body);

    const theme = await themeService.update(ctx.tenantId, themeId, data, ctx.userId);

    return ok(toThemeDetailDTO(theme));
  } catch (err) {
    return handleError(err);
  }
};
