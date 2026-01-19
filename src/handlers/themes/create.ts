import { APIGatewayProxyHandler } from 'aws-lambda';
import { CreateLookAndFeelSchema } from '../../dto/request/LookAndFeelDTO';
import { themeService } from '../../services/ThemeService';
import { toThemeDetailDTO } from '../../dto/response/LookAndFeelResponseDTO';
import { created } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext, parseBody } from '../middleware/requestContext';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const body = parseBody(event);

    const data = CreateLookAndFeelSchema.parse(body);
    const theme = await themeService.create(ctx.tenantId, data, ctx.userId);

    return created(toThemeDetailDTO(theme));
  } catch (err) {
    return handleError(err);
  }
};
