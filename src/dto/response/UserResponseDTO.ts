import { User, UserProfile, UserPreferences } from '../../domain/entities/User';

// Summary DTO (for lists)
export interface UserSummaryDTO {
  id: string;
  customerId?: string;
  email: string;
  username?: string;
  type: string;
  status: string;
  displayName: string;
  avatarUrl?: string;
  department?: string;
  jobTitle?: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

// Detail DTO (for single user)
export interface UserDetailDTO {
  id: string;
  tenantId: string;
  customerId?: string;
  partnerId?: string;
  email: string;
  emailVerified: boolean;
  username?: string;
  externalId?: string;
  type: string;
  status: string;
  profile: UserProfile;
  preferences: UserPreferences;
  mfaEnabled: boolean;
  mfaMethod?: string;
  lastLoginAt?: string;
  lastLoginIp?: string;
  activeSessions: number;
  invitedBy?: string;
  invitedAt?: string;
  invitationAcceptedAt?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Profile DTO (public profile)
export interface UserProfileDTO {
  id: string;
  displayName: string;
  avatarUrl?: string;
  department?: string;
  jobTitle?: string;
  bio?: string;
}

// Session DTO
export interface SessionDTO {
  id: string;
  deviceInfo: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
  isCurrent: boolean;
}

// MFA Setup DTO
export interface MfaSetupDTO {
  method: string;
  secret?: string; // For TOTP
  qrCodeUrl?: string; // For TOTP
  backupCodes?: string[];
}

// Invitation DTO
export interface InvitationDTO {
  id: string;
  email: string;
  type: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED';
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

export function toUserSummaryDTO(user: User): UserSummaryDTO {
  return {
    id: user.id,
    customerId: user.customerId,
    email: user.email,
    username: user.username,
    type: user.type,
    status: user.status,
    displayName: user.profile.displayName || `${user.profile.firstName} ${user.profile.lastName}`,
    avatarUrl: user.profile.avatarUrl,
    department: user.profile.department,
    jobTitle: user.profile.jobTitle,
    emailVerified: user.emailVerified,
    mfaEnabled: user.security.mfaEnabled,
    lastLoginAt: user.security.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export function toUserDetailDTO(user: User): UserDetailDTO {
  return {
    id: user.id,
    tenantId: user.tenantId,
    customerId: user.customerId,
    partnerId: user.partnerId,
    email: user.email,
    emailVerified: user.emailVerified,
    username: user.username,
    externalId: user.externalId,
    type: user.type,
    status: user.status,
    profile: user.profile,
    preferences: user.preferences,
    mfaEnabled: user.security.mfaEnabled,
    mfaMethod: user.security.mfaMethod,
    lastLoginAt: user.security.lastLoginAt,
    lastLoginIp: user.security.lastLoginIp,
    activeSessions: user.activeSessions,
    invitedBy: user.invitedBy,
    invitedAt: user.invitedAt,
    invitationAcceptedAt: user.invitationAcceptedAt,
    tags: user.tags,
    metadata: user.metadata,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toUserProfileDTO(user: User): UserProfileDTO {
  return {
    id: user.id,
    displayName: user.profile.displayName || `${user.profile.firstName} ${user.profile.lastName}`,
    avatarUrl: user.profile.avatarUrl,
    department: user.profile.department,
    jobTitle: user.profile.jobTitle,
    bio: user.profile.bio,
  };
}
