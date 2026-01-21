import { APIGatewayProxyHandler } from 'aws-lambda';
import { userService } from '../../services/UserService';
import { PasswordResetConfirmSchema } from '../../dto/request/AuthDTO';
import { handleError } from '../middleware/errorHandler';
import { parseBody, getTenantId } from '../middleware/requestContext';
import { success } from '../middleware/response';
import { ValidationError } from '../../shared/errors/AppError';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const tenantId = getTenantId(event);
    const body = parseBody(event);

    // Validate request body
    const result = PasswordResetConfirmSchema.safeParse(body);
    if (!result.success) {
      throw new ValidationError('Dados inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { token, newPassword } = result.data;

    await userService.resetPassword(tenantId, token, newPassword);

    return success({
      success: true,
      message: 'Senha redefinida com sucesso. Você já pode fazer login.',
    });
  } catch (err) {
    return handleError(err);
  }
};
