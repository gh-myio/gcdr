import { APIGatewayProxyHandler } from 'aws-lambda';
import { authService } from '../../services/AuthService';
import { LogoutRequestSchema } from '../../dto/request/AuthDTO';
import { handleError } from '../middleware/errorHandler';
import { parseBody, getTenantId, getCurrentUser } from '../middleware/requestContext';
import { success } from '../middleware/response';
import { ValidationError, UnauthorizedError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const tenantId = getTenantId(event);
    const user = getCurrentUser(event);

    if (!user) {
      throw new UnauthorizedError('Token de acesso inválido');
    }

    const body = parseBody(event);

    // Validate request body (optional fields)
    const result = LogoutRequestSchema.safeParse(body || {});
    if (!result.success) {
      throw new ValidationError('Dados de logout inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { refreshToken, allDevices } = result.data;

    if (allDevices) {
      await authService.logoutAllDevices(tenantId, user.sub);
    } else {
      await authService.logout(tenantId, user.sub, refreshToken);
    }

    return success({
      success: true,
      message: allDevices
        ? 'Logout realizado em todos os dispositivos'
        : 'Logout realizado com sucesso',
    });
  } catch (err) {
    return handleError(err);
  }
};
