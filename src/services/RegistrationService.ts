/**
 * RFC-0011: User Registration and Approval Workflow Service
 */

import * as crypto from 'crypto';
import { userRepository } from '../repositories/UserRepository';
import { verificationTokenRepository, VerificationTokenType } from '../repositories/VerificationTokenRepository';
import { ValidationError, UnauthorizedError, AppError } from '../shared/errors/AppError';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';

// Configuration
const MAX_FAILED_LOGIN_ATTEMPTS = 6;
const MAX_RESEND_PER_HOUR = 3;
const VERIFICATION_CODE_EXPIRY_MINUTES = 15;

/**
 * Hash password using SHA-256
 */
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export interface RegisterResponse {
  userId: string;
  email: string;
  status: string;
  message: string;
  expiresIn: number;
}

export interface VerifyEmailResponse {
  status: string;
  message: string;
}

export interface ResendVerificationResponse {
  message: string;
  expiresIn: number;
}

export interface PasswordResetResponse {
  message: string;
  unlocked?: boolean;
}

export class RegistrationService {

  /**
   * Register a new user (self-service)
   */
  async register(
    tenantId: string,
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    phone?: string,
    customerId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<RegisterResponse> {
    // Check if email already exists
    const existingUser = await userRepository.getByEmail(tenantId, email);
    if (existingUser) {
      throw new ValidationError('Email já está em uso');
    }

    // Hash password
    const passwordHash = hashPassword(password);

    // Create user with UNVERIFIED status
    const user = await userRepository.createSelfRegistered(
      tenantId,
      email,
      passwordHash,
      firstName,
      lastName,
      phone,
      customerId,
      ipAddress
    );

    // Create verification token
    const { code } = await verificationTokenRepository.create(
      tenantId,
      user.id,
      'EMAIL_VERIFICATION',
      ipAddress,
      userAgent
    );

    // TODO: Send email with verification code
    // For now, log it (in production, use email service)
    console.log(`[REGISTRATION] Verification code for ${email}: ${code}`);

    // Publish registration event
    await eventService.publish(EventType.USER_CREATED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'register',
      data: {
        email: user.email,
        status: 'UNVERIFIED',
        selfRegistered: true,
        ip: ipAddress,
      },
      actor: { userId: user.id, type: 'user' },
    });

    return {
      userId: user.id,
      email: user.email,
      status: 'UNVERIFIED',
      message: 'Código de verificação enviado para o email',
      expiresIn: VERIFICATION_CODE_EXPIRY_MINUTES * 60,
    };
  }

  /**
   * Verify email with 6-digit code
   */
  async verifyEmail(tenantId: string, email: string, code: string): Promise<VerifyEmailResponse> {
    // Find user
    const user = await userRepository.getByEmail(tenantId, email);
    if (!user) {
      throw new ValidationError('Email não encontrado');
    }

    // Check user status
    if (user.status !== 'UNVERIFIED') {
      if (user.emailVerified) {
        throw new ValidationError('Email já foi verificado');
      }
      throw new ValidationError('Usuário não está em estado de verificação');
    }

    // Verify code
    const result = await verificationTokenRepository.verify(
      tenantId,
      user.id,
      'EMAIL_VERIFICATION',
      code
    );

    if (!result.valid) {
      if (result.attemptsRemaining !== undefined && result.attemptsRemaining === 0) {
        throw new UnauthorizedError('Código expirado. Solicite um novo código de verificação.');
      }
      throw new UnauthorizedError(
        result.attemptsRemaining !== undefined
          ? `Código inválido. ${result.attemptsRemaining} tentativas restantes.`
          : result.reason || 'Código inválido ou expirado'
      );
    }

    // Update user status to PENDING_APPROVAL
    await userRepository.setEmailVerifiedPendingApproval(tenantId, user.id);

    // Publish event
    await eventService.publish(EventType.USER_UPDATED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'email_verified',
      data: {
        email: user.email,
        status: 'PENDING_APPROVAL',
      },
      actor: { userId: user.id, type: 'user' },
    });

    return {
      status: 'PENDING_APPROVAL',
      message: 'Email verificado com sucesso. Seu cadastro está aguardando aprovação.',
    };
  }

  /**
   * Resend verification code
   */
  async resendVerificationCode(
    tenantId: string,
    email: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<ResendVerificationResponse> {
    // Find user
    const user = await userRepository.getByEmail(tenantId, email);

    // Always return success to prevent enumeration
    if (!user || user.status !== 'UNVERIFIED') {
      return {
        message: 'Se o email existir e não estiver verificado, um novo código será enviado',
        expiresIn: VERIFICATION_CODE_EXPIRY_MINUTES * 60,
      };
    }

    // Check rate limit
    const recentCount = await verificationTokenRepository.countRecentTokens(
      tenantId,
      user.id,
      'EMAIL_VERIFICATION',
      60  // 1 hour
    );

    if (recentCount >= MAX_RESEND_PER_HOUR) {
      throw new ValidationError('Limite de reenvio excedido. Aguarde 1 hora para tentar novamente.');
    }

    // Create new verification token
    const { code } = await verificationTokenRepository.create(
      tenantId,
      user.id,
      'EMAIL_VERIFICATION',
      ipAddress,
      userAgent
    );

    // TODO: Send email with verification code
    console.log(`[REGISTRATION] New verification code for ${email}: ${code}`);

    return {
      message: 'Se o email existir e não estiver verificado, um novo código será enviado',
      expiresIn: VERIFICATION_CODE_EXPIRY_MINUTES * 60,
    };
  }

  /**
   * Request password reset - sends 6-digit code
   */
  async requestPasswordReset(
    tenantId: string,
    email: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    // Find user
    const user = await userRepository.getByEmail(tenantId, email);

    // Silently return if user not found (prevent enumeration)
    if (!user) {
      return;
    }

    // Only allow password reset for ACTIVE or LOCKED users
    if (!['ACTIVE', 'LOCKED'].includes(user.status)) {
      return;
    }

    // Create password reset token
    const { code } = await verificationTokenRepository.create(
      tenantId,
      user.id,
      'PASSWORD_RESET',
      ipAddress,
      userAgent
    );

    // TODO: Send email with reset code
    console.log(`[PASSWORD_RESET] Reset code for ${email}: ${code}`);

    // Publish event
    await eventService.publish(EventType.USER_UPDATED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'password_reset_requested',
      data: {
        email: user.email,
        ip: ipAddress,
      },
      actor: { userId: user.id, type: 'user' },
    });
  }

  /**
   * Reset password with 6-digit code
   */
  async resetPassword(
    tenantId: string,
    email: string,
    code: string,
    newPassword: string
  ): Promise<PasswordResetResponse> {
    // Find user
    const user = await userRepository.getByEmail(tenantId, email);
    if (!user) {
      throw new ValidationError('Email não encontrado');
    }

    // Only allow password reset for ACTIVE or LOCKED users
    if (!['ACTIVE', 'LOCKED'].includes(user.status)) {
      throw new ValidationError('Usuário não pode redefinir a senha neste estado');
    }

    // Verify code
    const result = await verificationTokenRepository.verify(
      tenantId,
      user.id,
      'PASSWORD_RESET',
      code
    );

    if (!result.valid) {
      if (result.attemptsRemaining !== undefined && result.attemptsRemaining === 0) {
        throw new UnauthorizedError('Código expirado. Solicite um novo código de recuperação.');
      }
      throw new UnauthorizedError(
        result.attemptsRemaining !== undefined
          ? `Código inválido. ${result.attemptsRemaining} tentativas restantes.`
          : result.reason || 'Código inválido ou expirado'
      );
    }

    // Hash new password
    const passwordHash = hashPassword(newPassword);

    // Reset password and unlock if needed
    const wasLocked = user.status === 'LOCKED';
    await userRepository.resetPasswordAndUnlock(tenantId, user.id, passwordHash);

    // Publish event
    await eventService.publish(EventType.USER_UPDATED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'password_reset_completed',
      data: {
        email: user.email,
        wasLocked,
      },
      actor: { userId: user.id, type: 'user' },
    });

    return {
      message: 'Senha alterada com sucesso',
      unlocked: wasLocked,
    };
  }

  /**
   * Increment failed login attempts and lock if needed
   * Returns the new count
   */
  async recordFailedLogin(tenantId: string, userId: string, ip: string): Promise<number> {
    const attempts = await userRepository.incrementFailedLoginAttempts(tenantId, userId);

    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await userRepository.lockAccountDueToFailedAttempts(
        tenantId,
        userId,
        'Conta bloqueada após 6 tentativas de login incorretas'
      );

      // Publish event
      await eventService.publish(EventType.USER_UPDATED, {
        tenantId,
        entityType: 'user',
        entityId: userId,
        action: 'account_locked',
        data: {
          reason: 'Too many failed login attempts',
          failedAttempts: attempts,
          ip,
        },
        actor: { userId, type: 'system' },
      });
    }

    return attempts;
  }

  /**
   * Reset failed login attempts (on successful login)
   */
  async recordSuccessfulLogin(tenantId: string, userId: string, ip: string): Promise<void> {
    await userRepository.recordLogin(tenantId, userId, ip);
  }

  /**
   * Approve user registration (admin action)
   */
  async approveUser(tenantId: string, userId: string, approvedBy: string): Promise<void> {
    const user = await userRepository.getById(tenantId, userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    if (user.status !== 'PENDING_APPROVAL') {
      throw new ValidationError('Usuário não está aguardando aprovação');
    }

    await userRepository.approveUser(tenantId, userId, approvedBy);

    // TODO: Send approval notification email
    console.log(`[REGISTRATION] User ${user.email} approved by ${approvedBy}`);

    // Publish event
    await eventService.publish(EventType.USER_UPDATED, {
      tenantId,
      entityType: 'user',
      entityId: userId,
      action: 'approved',
      data: {
        email: user.email,
        status: 'ACTIVE',
      },
      actor: { userId: approvedBy, type: 'user' },
    });
  }

  /**
   * Reject user registration (admin action)
   */
  async rejectUser(tenantId: string, userId: string, rejectedBy: string, reason: string): Promise<void> {
    const user = await userRepository.getById(tenantId, userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    if (user.status !== 'PENDING_APPROVAL') {
      throw new ValidationError('Usuário não está aguardando aprovação');
    }

    await userRepository.rejectUser(tenantId, userId, rejectedBy, reason);

    // TODO: Send rejection notification email
    console.log(`[REGISTRATION] User ${user.email} rejected by ${rejectedBy}: ${reason}`);

    // Publish event
    await eventService.publish(EventType.USER_UPDATED, {
      tenantId,
      entityType: 'user',
      entityId: userId,
      action: 'rejected',
      data: {
        email: user.email,
        status: 'INACTIVE',
        reason,
      },
      actor: { userId: rejectedBy, type: 'user' },
    });
  }

  /**
   * Unlock user account (admin action)
   */
  async unlockUser(tenantId: string, userId: string, unlockedBy: string): Promise<void> {
    const user = await userRepository.getById(tenantId, userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    if (user.status !== 'LOCKED') {
      throw new ValidationError('Usuário não está bloqueado');
    }

    await userRepository.unlockUser(tenantId, userId);

    // TODO: Send unlock notification email
    console.log(`[REGISTRATION] User ${user.email} unlocked by ${unlockedBy}`);

    // Publish event
    await eventService.publish(EventType.USER_UPDATED, {
      tenantId,
      entityType: 'user',
      entityId: userId,
      action: 'unlocked',
      data: {
        email: user.email,
        status: 'ACTIVE',
      },
      actor: { userId: unlockedBy, type: 'user' },
    });
  }

  /**
   * List users pending approval
   */
  async listPendingApproval(tenantId: string): Promise<Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    registeredAt?: string;
    emailVerifiedAt?: string;
    registrationIp?: string;
  }>> {
    const users = await userRepository.listPendingApproval(tenantId);

    return users.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      registeredAt: user.security.registeredAt,
      emailVerifiedAt: user.security.emailVerifiedAt,
      registrationIp: user.security.registrationIp,
    }));
  }
}

// Export singleton instance
export const registrationService = new RegistrationService();
