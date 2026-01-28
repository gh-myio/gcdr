import { z } from 'zod';

// Profile Schema
const UserProfileSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  displayName: z.string().max(200).optional(),
  avatarUrl: z.string().url().optional(),
  phone: z.string().max(20).optional(),
  department: z.string().max(100).optional(),
  jobTitle: z.string().max(100).optional(),
  bio: z.string().max(500).optional(),
});

// Preferences Schema
const NotificationPreferencesSchema = z.object({
  email: z.boolean().default(true),
  push: z.boolean().default(true),
  sms: z.boolean().default(false),
  inApp: z.boolean().default(true),
});

const UserPreferencesSchema = z.object({
  language: z.string().max(10).default('pt-BR'),
  timezone: z.string().max(50).default('America/Sao_Paulo'),
  dateFormat: z.string().max(20).default('DD/MM/YYYY'),
  timeFormat: z.enum(['12h', '24h']).default('24h'),
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  notifications: NotificationPreferencesSchema.optional(),
  dashboardLayout: z.record(z.unknown()).optional(),
});

// Create User DTO
export const CreateUserSchema = z.object({
  customerId: z.string().uuid().optional(),
  partnerId: z.string().uuid().optional(),
  email: z.string().email().max(255),
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(8).max(100).optional(), // Optional for SSO users
  type: z.enum(['INTERNAL', 'CUSTOMER', 'PARTNER', 'SERVICE_ACCOUNT']).default('CUSTOMER'),
  profile: UserProfileSchema,
  preferences: UserPreferencesSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
  metadata: z.record(z.unknown()).default({}),
  sendInvitation: z.boolean().default(true),
});

export type CreateUserDTO = z.infer<typeof CreateUserSchema>;

// Update User DTO
export const UpdateUserSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  profile: UserProfileSchema.partial().optional(),
  preferences: UserPreferencesSchema.partial().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateUserDTO = z.infer<typeof UpdateUserSchema>;

// Update User Status DTO (RFC-0011: Updated status values)
export const UpdateUserStatusSchema = z.object({
  status: z.enum(['UNVERIFIED', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'LOCKED']),
  reason: z.string().max(500).optional(),
});

export type UpdateUserStatusDTO = z.infer<typeof UpdateUserStatusSchema>;

// Change Password DTO
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export type ChangePasswordDTO = z.infer<typeof ChangePasswordSchema>;

// Reset Password Request DTO
export const RequestPasswordResetSchema = z.object({
  email: z.string().email(),
});

export type RequestPasswordResetDTO = z.infer<typeof RequestPasswordResetSchema>;

// Reset Password DTO
export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export type ResetPasswordDTO = z.infer<typeof ResetPasswordSchema>;

// Enable MFA DTO
export const EnableMfaSchema = z.object({
  method: z.enum(['totp', 'sms', 'email']),
  verificationCode: z.string().min(6).max(6).optional(), // Required for confirmation step
});

export type EnableMfaDTO = z.infer<typeof EnableMfaSchema>;

// Verify Email DTO
export const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});

export type VerifyEmailDTO = z.infer<typeof VerifyEmailSchema>;

// Invite User DTO
export const InviteUserSchema = z.object({
  email: z.string().email().max(255),
  customerId: z.string().uuid().optional(),
  type: z.enum(['INTERNAL', 'CUSTOMER', 'PARTNER']).default('CUSTOMER'),
  profile: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
  }),
  roleKeys: z.array(z.string()).optional(), // Roles to assign after acceptance
  message: z.string().max(500).optional(), // Custom invitation message
});

export type InviteUserDTO = z.infer<typeof InviteUserSchema>;

// Accept Invitation DTO
export const AcceptInvitationSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(100),
  profile: UserProfileSchema.partial().optional(),
});

export type AcceptInvitationDTO = z.infer<typeof AcceptInvitationSchema>;

// List Users Query (RFC-0011: Updated status values)
export const ListUsersSchema = z.object({
  customerId: z.string().uuid().optional(),
  partnerId: z.string().uuid().optional(),
  type: z.enum(['INTERNAL', 'CUSTOMER', 'PARTNER', 'SERVICE_ACCOUNT']).optional(),
  status: z.enum(['UNVERIFIED', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
  search: z.string().max(100).optional(), // Search by name or email
  limit: z.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export type ListUsersDTO = z.infer<typeof ListUsersSchema>;

// Update Preferences DTO
export const UpdatePreferencesSchema = UserPreferencesSchema.partial();

export type UpdatePreferencesDTO = z.infer<typeof UpdatePreferencesSchema>;
