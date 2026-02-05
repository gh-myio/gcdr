import * as crypto from 'crypto';
import { User, UserStatus } from '../domain/entities/User';
import {
  CreateUserDTO,
  UpdateUserDTO,
  ListUsersDTO,
  InviteUserDTO,
  ChangePasswordDTO,
  UpdatePreferencesDTO,
} from '../dto/request/UserDTO';
import { MfaSetupDTO } from '../dto/response/UserResponseDTO';
import { UserRepository } from '../repositories/UserRepository';
import { IUserRepository } from '../repositories/interfaces/IUserRepository';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
import { PaginatedResult } from '../shared/types';
import { NotFoundError, ConflictError, ValidationError, UnauthorizedError } from '../shared/errors/AppError';

// Simple hash function for passwords (in production, use bcrypt or argon2)
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateBackupCodes(count: number = 10): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase()
  );
}

export class UserService {
  private repository: IUserRepository;
  private maxFailedAttempts = 5;
  private lockDurationMinutes = 30;

  constructor(repository?: IUserRepository) {
    this.repository = repository || new UserRepository();
  }

  async create(tenantId: string, data: CreateUserDTO, createdBy: string): Promise<User> {
    // Check for duplicate email
    const existingEmail = await this.repository.getByEmail(tenantId, data.email);
    if (existingEmail) {
      throw new ConflictError(`User with email ${data.email} already exists`);
    }

    // Check for duplicate username if provided
    if (data.username) {
      const existingUsername = await this.repository.getByUsername(tenantId, data.username);
      if (existingUsername) {
        throw new ConflictError(`Username ${data.username} is already taken`);
      }
    }

    const user = await this.repository.create(tenantId, data, createdBy);

    // Set password if provided
    if (data.password) {
      await this.repository.updatePassword(tenantId, user.id, hashPassword(data.password));
    }

    // Generate email verification token
    const verificationToken = generateToken();
    await this.repository.setEmailVerificationToken(tenantId, user.id, verificationToken);

    // Publish event
    await eventService.publish(EventType.USER_CREATED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'created',
      data: {
        email: user.email,
        type: user.type,
        customerId: user.customerId,
      },
      actor: { userId: createdBy, type: 'user' },
    });

    return user;
  }

  async invite(tenantId: string, data: InviteUserDTO, invitedBy: string): Promise<User> {
    // Check for existing user with same email
    const existing = await this.repository.getByEmail(tenantId, data.email);
    if (existing) {
      throw new ConflictError(`User with email ${data.email} already exists`);
    }

    // Create user in pending state
    const user = await this.repository.create(
      tenantId,
      {
        email: data.email,
        customerId: data.customerId,
        type: data.type,
        profile: {
          firstName: data.profile.firstName,
          lastName: data.profile.lastName,
        },
        sendInvitation: true,
        tags: [],
        metadata: {},
      },
      invitedBy
    );

    // Generate invitation token (reuse email verification)
    const invitationToken = generateToken();
    await this.repository.setEmailVerificationToken(tenantId, user.id, invitationToken);

    // Publish event
    await eventService.publish(EventType.USER_INVITED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'invited',
      data: {
        email: user.email,
        invitedBy,
        customerId: data.customerId,
      },
      actor: { userId: invitedBy, type: 'user' },
    });

    // TODO: Send invitation email with token

    return user;
  }

  async getById(tenantId: string, id: string): Promise<User> {
    const user = await this.repository.getById(tenantId, id);
    if (!user) {
      throw new NotFoundError(`User ${id} not found`);
    }
    return user;
  }

  async getByEmail(tenantId: string, email: string): Promise<User> {
    const user = await this.repository.getByEmail(tenantId, email);
    if (!user) {
      throw new NotFoundError(`User with email ${email} not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.repository.findByEmail(email);
    if (!user) {
      throw new NotFoundError(`User with email ${email} not found`);
    }
    return user;
  }

  async update(tenantId: string, id: string, data: UpdateUserDTO, updatedBy: string): Promise<User> {
    const existing = await this.getById(tenantId, id);

    // Check for duplicate username if updating
    if (data.username && data.username !== existing.username) {
      const duplicateUsername = await this.repository.getByUsername(tenantId, data.username);
      if (duplicateUsername && duplicateUsername.id !== id) {
        throw new ConflictError(`Username ${data.username} is already taken`);
      }
    }

    const user = await this.repository.update(tenantId, id, data, updatedBy);

    // Publish event
    await eventService.publish(EventType.USER_UPDATED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'updated',
      data: { updatedFields: Object.keys(data) },
      actor: { userId: updatedBy, type: 'user' },
    });

    return user;
  }

  async delete(tenantId: string, id: string, deletedBy: string): Promise<void> {
    const user = await this.getById(tenantId, id);

    await this.repository.delete(tenantId, id);

    // Publish event
    await eventService.publish(EventType.USER_DELETED, {
      tenantId,
      entityType: 'user',
      entityId: id,
      action: 'deleted',
      data: {
        email: user.email,
        customerId: user.customerId,
      },
      actor: { userId: deletedBy, type: 'user' },
    });
  }

  async list(tenantId: string, params: ListUsersDTO): Promise<PaginatedResult<User>> {
    return this.repository.list(tenantId, params);
  }

  async listByCustomer(tenantId: string, customerId: string): Promise<User[]> {
    return this.repository.listByCustomer(tenantId, customerId);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: UserStatus,
    updatedBy: string,
    reason?: string
  ): Promise<User> {
    const user = await this.getById(tenantId, id);
    const previousStatus = user.status;

    const updated = await this.repository.updateStatus(tenantId, id, status, updatedBy, reason);

    // Publish event
    await eventService.publish(EventType.USER_STATUS_CHANGED, {
      tenantId,
      entityType: 'user',
      entityId: id,
      action: 'status_changed',
      data: {
        previousStatus,
        newStatus: status,
        reason,
      },
      actor: { userId: updatedBy, type: 'user' },
    });

    return updated;
  }

  async changePassword(
    tenantId: string,
    id: string,
    data: ChangePasswordDTO
  ): Promise<void> {
    const user = await this.getById(tenantId, id);

    // Verify current password
    if (!user.security.passwordHash || !verifyPassword(data.currentPassword, user.security.passwordHash)) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Update password
    await this.repository.updatePassword(tenantId, id, hashPassword(data.newPassword));

    // Publish event
    await eventService.publish(EventType.USER_PASSWORD_CHANGED, {
      tenantId,
      entityType: 'user',
      entityId: id,
      action: 'password_changed',
      data: {},
      actor: { userId: id, type: 'user' },
    });
  }

  async requestPasswordReset(tenantId: string, email: string): Promise<void> {
    const user = await this.repository.getByEmail(tenantId, email);
    if (!user) {
      // Don't reveal if user exists
      return;
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    await this.repository.setPasswordResetToken(tenantId, user.id, token, expiresAt);

    // Publish event
    await eventService.publish(EventType.USER_PASSWORD_RESET_REQUESTED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'password_reset_requested',
      data: { email },
      actor: { type: 'system' },
    });

    // TODO: Send password reset email with token
  }

  async resetPassword(tenantId: string, token: string, newPassword: string): Promise<void> {
    // Find user by token (would need a GSI for this in production)
    // For now, this is a simplified implementation
    const users = await this.repository.list(tenantId, { limit: 100 });
    const user = users.items.find(
      (u) =>
        u.security.passwordResetToken === token &&
        u.security.passwordResetExpiresAt &&
        new Date(u.security.passwordResetExpiresAt) > new Date()
    );

    if (!user) {
      throw new ValidationError('Invalid or expired reset token');
    }

    await this.repository.updatePassword(tenantId, user.id, hashPassword(newPassword));
    await this.repository.clearPasswordResetToken(tenantId, user.id);

    // Publish event
    await eventService.publish(EventType.USER_PASSWORD_CHANGED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'password_reset',
      data: {},
      actor: { type: 'system' },
    });
  }

  async verifyEmail(tenantId: string, token: string): Promise<User> {
    // Find user by token
    const users = await this.repository.list(tenantId, { limit: 100 });
    const user = users.items.find((u) => u.security.emailVerificationToken === token);

    if (!user) {
      throw new ValidationError('Invalid verification token');
    }

    await this.repository.verifyEmail(tenantId, user.id);

    // Publish event
    await eventService.publish(EventType.USER_EMAIL_VERIFIED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'email_verified',
      data: { email: user.email },
      actor: { type: 'system' },
    });

    return this.getById(tenantId, user.id);
  }

  async setupMfa(tenantId: string, id: string, method: 'totp' | 'sms' | 'email'): Promise<MfaSetupDTO> {
    await this.getById(tenantId, id);

    const secret = crypto.randomBytes(20).toString('hex');
    const backupCodes = generateBackupCodes();

    // For TOTP, generate QR code URL
    let qrCodeUrl: string | undefined;
    if (method === 'totp') {
      // In production, use a proper TOTP library
      qrCodeUrl = `otpauth://totp/GCDR:user?secret=${secret}&issuer=GCDR`;
    }

    // Store temporarily (user needs to verify before enabling)
    // In production, store in a temporary location until verified

    return {
      method,
      secret: method === 'totp' ? secret : undefined,
      qrCodeUrl,
      backupCodes,
    };
  }

  async enableMfa(
    tenantId: string,
    id: string,
    method: 'totp' | 'sms' | 'email',
    secret: string,
    verificationCode: string
  ): Promise<void> {
    const user = await this.getById(tenantId, id);

    // TODO: Verify the code before enabling
    // For now, we just enable it

    const backupCodes = generateBackupCodes();
    await this.repository.enableMfa(tenantId, id, method, secret, backupCodes);

    // Publish event
    await eventService.publish(EventType.USER_MFA_ENABLED, {
      tenantId,
      entityType: 'user',
      entityId: id,
      action: 'mfa_enabled',
      data: { method },
      actor: { userId: id, type: 'user' },
    });
  }

  async disableMfa(tenantId: string, id: string, disabledBy: string): Promise<void> {
    await this.getById(tenantId, id);

    await this.repository.disableMfa(tenantId, id);

    // Publish event
    await eventService.publish(EventType.USER_MFA_DISABLED, {
      tenantId,
      entityType: 'user',
      entityId: id,
      action: 'mfa_disabled',
      data: {},
      actor: { userId: disabledBy, type: 'user' },
    });
  }

  async recordLoginAttempt(tenantId: string, email: string, success: boolean, ip: string): Promise<void> {
    const user = await this.repository.getByEmail(tenantId, email);
    if (!user) return;

    if (success) {
      await this.repository.recordLogin(tenantId, user.id, ip);
      await this.repository.resetFailedLoginAttempts(tenantId, user.id);
    } else {
      const attempts = await this.repository.incrementFailedLoginAttempts(tenantId, user.id);

      if (attempts >= this.maxFailedAttempts) {
        const lockUntil = new Date(Date.now() + this.lockDurationMinutes * 60 * 1000).toISOString();
        await this.repository.lockUser(tenantId, user.id, lockUntil);

        // Publish event
        await eventService.publish(EventType.USER_LOCKED, {
          tenantId,
          entityType: 'user',
          entityId: user.id,
          action: 'locked',
          data: {
            reason: 'Too many failed login attempts',
            lockedUntil: lockUntil,
          },
          actor: { type: 'system' },
        });
      }
    }
  }

  async unlockUser(tenantId: string, id: string, unlockedBy: string): Promise<User> {
    await this.getById(tenantId, id);

    await this.repository.unlockUser(tenantId, id);

    // Publish event
    await eventService.publish(EventType.USER_UNLOCKED, {
      tenantId,
      entityType: 'user',
      entityId: id,
      action: 'unlocked',
      data: {},
      actor: { userId: unlockedBy, type: 'user' },
    });

    return this.getById(tenantId, id);
  }

  async updatePreferences(
    tenantId: string,
    id: string,
    preferences: UpdatePreferencesDTO
  ): Promise<User> {
    return this.repository.update(tenantId, id, { preferences }, id);
  }

  async acceptInvitation(
    tenantId: string,
    token: string,
    password: string
  ): Promise<User> {
    // Find user by invitation token (RFC-0011: UNVERIFIED replaces PENDING_VERIFICATION)
    const users = await this.repository.list(tenantId, { status: 'UNVERIFIED', limit: 100 });
    const user = users.items.find((u) => u.security.emailVerificationToken === token);

    if (!user) {
      throw new ValidationError('Invalid or expired invitation token');
    }

    // Set password and mark as verified
    await this.repository.updatePassword(tenantId, user.id, hashPassword(password));
    await this.repository.verifyEmail(tenantId, user.id);
    await this.repository.setInvitationAccepted(tenantId, user.id);

    // Publish event
    await eventService.publish(EventType.USER_INVITATION_ACCEPTED, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'invitation_accepted',
      data: { email: user.email },
      actor: { userId: user.id, type: 'user' },
    });

    return this.getById(tenantId, user.id);
  }
}

export const userService = new UserService();
