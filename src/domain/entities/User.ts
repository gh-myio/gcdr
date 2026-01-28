import { BaseEntity } from '../../shared/types';

// RFC-0011: Updated user status with full lifecycle
export type UserStatus = 'UNVERIFIED' | 'PENDING_APPROVAL' | 'ACTIVE' | 'INACTIVE' | 'LOCKED';
export type UserType = 'INTERNAL' | 'CUSTOMER' | 'PARTNER' | 'SERVICE_ACCOUNT';

export interface UserPreferences {
  language: string;
  timezone: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  theme: 'light' | 'dark' | 'system';
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
    inApp: boolean;
  };
  dashboardLayout?: Record<string, unknown>;
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  displayName?: string;
  avatarUrl?: string;
  phone?: string;
  phoneVerified?: boolean;
  department?: string;
  jobTitle?: string;
  bio?: string;
}

export interface UserSecurity {
  // Password
  passwordHash?: string;
  passwordChangedAt?: string;

  // MFA
  mfaEnabled: boolean;
  mfaMethod?: 'totp' | 'sms' | 'email';
  mfaSecret?: string;
  mfaBackupCodes?: string[];

  // Login tracking
  lastLoginAt?: string;
  lastLoginIp?: string;
  failedLoginAttempts: number;

  // Account lockout (RFC-0011)
  lockedUntil?: string;
  lockedAt?: string;
  lockedReason?: string;
  lockoutCount?: number;

  // Legacy tokens (deprecated - use verification_tokens table)
  passwordResetToken?: string;
  passwordResetExpiresAt?: string;
  emailVerificationToken?: string;

  // Email verification
  emailVerifiedAt?: string;

  // RFC-0011: Registration tracking
  registeredAt?: string;
  registrationIp?: string;

  // RFC-0011: Approval tracking
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
}

export interface UserSession {
  id: string;
  deviceInfo: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
}

export interface User extends BaseEntity {
  // Association
  customerId?: string; // Which customer this user belongs to (null for system users)
  partnerId?: string; // If user is from a partner

  // Identity
  email: string;
  emailVerified: boolean;
  username?: string;
  externalId?: string; // For SSO/external identity providers

  // Type and Status
  type: UserType;
  status: UserStatus;

  // Profile
  profile: UserProfile;

  // Security
  security: UserSecurity;

  // Preferences
  preferences: UserPreferences;

  // Sessions (stored separately but tracked here)
  activeSessions: number;

  // Invitation
  invitedBy?: string;
  invitedAt?: string;
  invitationAcceptedAt?: string;

  // Tags and metadata
  tags: string[];
  metadata: Record<string, unknown>;
}

export function createDefaultPreferences(): UserPreferences {
  return {
    language: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    theme: 'system',
    notifications: {
      email: true,
      push: true,
      sms: false,
      inApp: true,
    },
  };
}

export function createDefaultSecurity(): UserSecurity {
  return {
    mfaEnabled: false,
    failedLoginAttempts: 0,
    lockoutCount: 0,
  };
}

export function createDefaultProfile(firstName: string, lastName: string): UserProfile {
  return {
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
  };
}
