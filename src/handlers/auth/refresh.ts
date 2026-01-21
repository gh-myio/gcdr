import { APIGatewayProxyHandler } from 'aws-lambda';
import { authService } from '../../services/AuthService';
import { RefreshTokenRequestSchema } from '../../dto/request/AuthDTO';
import { handleError } from '../middleware/errorHandler';
import { parseBody, getTenantId } from '../middleware/requestContext';
import { success } from '../middleware/response';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const tenantId = getTenantId(event);
    const body = parseBody(event);

    // Validate request body
    const result = RefreshTokenRequestSchema.safeParse(body);
    if (!result.success) {
      throw new ValidationError('Refresh token inválido', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { refreshToken } = result.data;

    const response = await authService.refresh(tenantId, refreshToken);

    return success(response);
  } catch (err) {
    return handleError(err);
  }
};
