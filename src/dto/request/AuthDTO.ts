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
