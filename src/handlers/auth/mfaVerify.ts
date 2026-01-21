import { APIGatewayProxyHandler } from 'aws-lambda';
import { authService } from '../../services/AuthService';
import { MfaVerifyRequestSchema } from '../../dto/request/AuthDTO';
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
    const result = MfaVerifyRequestSchema.safeParse(body);
    if (!result.success) {
      throw new ValidationError('Dados de MFA inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { mfaToken, code, useBackupCode } = result.data;

    const response = await authService.verifyMfa(tenantId, mfaToken, code, useBackupCode, ip);

    return success(response);
  } catch (err) {
    return handleError(err);
  }
};
