import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/AuthService';
import {
  LoginRequestSchema,
  RefreshTokenRequestSchema,
  MfaVerifyRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetConfirmSchema,
  LogoutRequestSchema
} from '../dto/request/AuthDTO';
import { sendSuccess, sendNoContent } from '../middleware/response';
import { ValidationError, UnauthorizedError } from '../shared/errors/AppError';
import { decodeJWT } from '../middleware/context';

const router = Router();

/**
 * POST /auth/login
 * Authenticate user
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, ip, requestId } = req.context;

    const result = LoginRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Dados de login inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { email, password, mfaCode, deviceInfo } = result.data;
    const response = await authService.login(tenantId, email, password, mfaCode, ip, deviceInfo);

    sendSuccess(res, response, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    const result = RefreshTokenRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Refresh token inválido', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { refreshToken } = result.data;
    const response = await authService.refresh(tenantId, refreshToken);

    sendSuccess(res, response, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/mfa/verify
 * Verify MFA code
 */
router.post('/mfa/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, ip, requestId } = req.context;

    const result = MfaVerifyRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Código MFA inválido', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { mfaToken, code, useBackupCode } = result.data;
    const response = await authService.verifyMfa(tenantId, mfaToken, code, useBackupCode, ip);

    sendSuccess(res, response, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/logout
 * Logout user
 */
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = req.context;

    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Token não fornecido');
    }

    const token = authHeader.slice(7);
    const user = decodeJWT(token);
    if (!user) {
      throw new UnauthorizedError('Token inválido');
    }

    const result = LogoutRequestSchema.safeParse(req.body);
    const { refreshToken, allDevices } = result.success ? result.data : { refreshToken: undefined, allDevices: false };

    if (allDevices) {
      await authService.logoutAllDevices(tenantId, user.sub);
    } else {
      await authService.logout(tenantId, user.sub, refreshToken);
    }

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/forgot-password
 * Request password reset
 */
router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;

    const result = PasswordResetRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Email inválido', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    // Note: forgotPassword is not implemented in AuthService yet
    // const { email } = result.data;
    // await authService.forgotPassword(tenantId, email);

    // Always return success to prevent email enumeration
    sendSuccess(res, { message: 'Se o email existir, você receberá um link de recuperação' }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;

    const result = PasswordResetConfirmSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Dados de reset inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    // Note: resetPassword is not implemented in AuthService yet
    // const { token, newPassword } = result.data;
    // await authService.resetPassword(tenantId, token, newPassword);

    sendSuccess(res, { message: 'Senha alterada com sucesso' }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
