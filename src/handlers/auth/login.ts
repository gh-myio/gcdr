import { APIGatewayProxyHandler } from 'aws-lambda';
import { authService } from '../../services/AuthService';
import { LoginRequestSchema } from '../../dto/request/AuthDTO';
import { handleError } from '../middleware/errorHandler';
import { parseBody, getTenantId, getClientIp } from '../middleware/requestContext';
import { success } from '../middleware/response';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const tenantId = getTenantId(event);
    const body = parseBody(event);
    const ip = getClientIp(event);

    // Validate request body
    const result = LoginRequestSchema.safeParse(body);
    if (!result.success) {
      throw new ValidationError('Dados de login inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { email, password, mfaCode, deviceInfo } = result.data;

    const response = await authService.login(tenantId, email, password, mfaCode, ip, deviceInfo);

    return success(response);
  } catch (err) {
    return handleError(err);
  }
};
