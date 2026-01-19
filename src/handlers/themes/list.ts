import { APIGatewayProxyHandler } from 'aws-lambda';
import { z } from 'zod';
import { themeService } from '../../services/ThemeService';
import { toThemeSummaryDTO } from '../../dto/response/LookAndFeelResponseDTO';
import { ok } from '../middleware/response';
import { handleError } from '../middleware/errorHandler';
import { extractContext } from '../middleware/requestContext';

const ListThemesQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const ctx = extractContext(event);
    const queryParams = event.queryStringParameters || {};

    const params = ListThemesQuerySchema.parse(queryParams);

    const result = await themeService.list(ctx.tenantId, params);

    return ok({
      items: result.items.map(toThemeSummaryDTO),
      pagination: result.pagination,
    });
  } catch (err) {
    return handleError(err);
  }
};
