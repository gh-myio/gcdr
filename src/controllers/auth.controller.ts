import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/AuthService';
import {
  LoginRequestSchema,
  RefreshTokenRequestSchema,
  MfaVerifyRequestSchema,
  PasswordResetRequestSchema,
  PasswordResetWithCodeSchema,
  LogoutRequestSchema,
  RegisterRequestSchema,
  VerifyEmailRequestSchema,
  ResendVerificationRequestSchema,
} from '../dto/request/AuthDTO';
import { sendSuccess, sendCreated, sendNoContent } from '../middleware/response';
import { ValidationError, UnauthorizedError } from '../shared/errors/AppError';
import { decodeJWT } from '../middleware/context';
import { registrationService } from '../services/RegistrationService';

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

// =============================================================================
// RFC-0011: User Registration and Approval Workflow
// =============================================================================

/**
 * POST /auth/register
 * Self-service user registration
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, ip, requestId } = req.context;

    const result = RegisterRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Dados de registro inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { email, password, firstName, lastName, phone, customerId } = result.data;
    const userAgent = req.headers['user-agent'];

    const response = await registrationService.register(
      tenantId,
      email,
      password,
      firstName,
      lastName,
      phone,
      customerId,
      ip,
      userAgent
    );

    sendCreated(res, response, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/verify-email
 * Verify email with 6-digit code
 */
router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    const result = VerifyEmailRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Dados de verificação inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { email, code } = result.data;
    const response = await registrationService.verifyEmail(tenantId, email, code);

    sendSuccess(res, response, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/resend-verification
 * Resend email verification code
 */
router.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, ip, requestId } = req.context;

    const result = ResendVerificationRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Email inválido', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { email } = result.data;
    const userAgent = req.headers['user-agent'];

    const response = await registrationService.resendVerificationCode(tenantId, email, ip, userAgent);

    sendSuccess(res, response, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/forgot-password
 * Request password reset - sends 6-digit code
 */
router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, ip, requestId } = req.context;

    const result = PasswordResetRequestSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Email inválido', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { email } = result.data;
    const userAgent = req.headers['user-agent'];

    // Always return success to prevent email enumeration
    await registrationService.requestPasswordReset(tenantId, email, ip, userAgent);

    sendSuccess(res, {
      message: 'Se o email existir, você receberá um código de recuperação',
      expiresIn: 900,  // 15 minutes
    }, 200, requestId);
  } catch (err) {
    // Log the error but don't expose to user (prevent enumeration)
    console.error('Password reset request error:', err);
    const { requestId } = req.context;
    sendSuccess(res, {
      message: 'Se o email existir, você receberá um código de recuperação',
      expiresIn: 900,
    }, 200, requestId);
  }
});

/**
 * POST /auth/reset-password
 * Reset password with 6-digit code
 */
router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tenantId, requestId } = req.context;

    const result = PasswordResetWithCodeSchema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Dados de reset inválidos', {
        validation: result.error.errors.map((e) => e.message),
      });
    }

    const { email, code, newPassword } = result.data;
    const response = await registrationService.resetPassword(tenantId, email, code, newPassword);

    sendSuccess(res, response, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
