import { z } from 'zod';

// Login Request
export const LoginRequestSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Senha é obrigatória'),
  mfaCode: z.string().length(6).optional(),
  deviceInfo: z.string().optional(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// Refresh Token Request
export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token é obrigatório'),
});

export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

// MFA Verify Request
export const MfaVerifyRequestSchema = z.object({
  mfaToken: z.string().min(1, 'MFA token é obrigatório'),
  code: z.string().length(6, 'Código deve ter 6 dígitos'),
  useBackupCode: z.boolean().optional().default(false),
});

export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

// Password Reset Request
export const PasswordResetRequestSchema = z.object({
  email: z.string().email('Email inválido'),
});

export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

// Password Reset Confirm
export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  newPassword: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número'),
});

export type PasswordResetConfirm = z.infer<typeof PasswordResetConfirmSchema>;

// Logout Request
export const LogoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
  allDevices: z.boolean().optional().default(false),
});

export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

// =============================================================================
// RFC-0011: User Registration and Approval Workflow
// =============================================================================

// Registration Request
export const RegisterRequestSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Senha deve conter pelo menos um caractere especial'),
  firstName: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  lastName: z.string().min(2, 'Sobrenome deve ter no mínimo 2 caracteres'),
  phone: z.string().optional(),
  customerId: z.string().uuid().optional(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

// Email Verification Request
export const VerifyEmailRequestSchema = z.object({
  email: z.string().email('Email inválido'),
  code: z.string().length(6, 'Código deve ter 6 dígitos').regex(/^\d{6}$/, 'Código deve conter apenas números'),
});

export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

// Resend Verification Request
export const ResendVerificationRequestSchema = z.object({
  email: z.string().email('Email inválido'),
});

export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

// Password Reset with Code (RFC-0011)
export const PasswordResetWithCodeSchema = z.object({
  email: z.string().email('Email inválido'),
  code: z.string().length(6, 'Código deve ter 6 dígitos').regex(/^\d{6}$/, 'Código deve conter apenas números'),
  newPassword: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número')
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Senha deve conter pelo menos um caractere especial'),
});

export type PasswordResetWithCode = z.infer<typeof PasswordResetWithCodeSchema>;

// Admin Approve User Request
export const ApproveUserRequestSchema = z.object({
  assignRoles: z.array(z.string()).optional(),
  customerId: z.string().uuid().optional(),
});

export type ApproveUserRequest = z.infer<typeof ApproveUserRequestSchema>;

// Admin Reject User Request
export const RejectUserRequestSchema = z.object({
  reason: z.string().min(1, 'Motivo da rejeição é obrigatório'),
});

export type RejectUserRequest = z.infer<typeof RejectUserRequestSchema>;
