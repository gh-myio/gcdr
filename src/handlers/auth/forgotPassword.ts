import { APIGatewayProxyHandler } from 'aws-lambda';
import { userService } from '../../services/UserService';
import { PasswordResetRequestSchema } from '../../dto/request/AuthDTO';
import { handleError } from '../middleware/errorHandler';
import { parseBody, getTenantId } from '../middleware/requestContext';
import { success } from '../middleware/response';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const tenantId = getTenantId(event);
    const body = parseBody(event);

    // Validate request body
    const result = PasswordResetRequestSchema.safeParse(body);
    if (!result.success) {
      throw new ValidationError('Email inválido', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { email } = result.data;

    // Request password reset (does not reveal if user exists)
    await userService.requestPasswordReset(tenantId, email);

    // Always return success to prevent email enumeration
    return success({
      success: true,
      message:
        'Se o email estiver cadastrado, você receberá instruções para redefinir sua senha.',
    });
  } catch (err) {
    return handleError(err);
  }
};
