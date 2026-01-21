export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number; // seconds
  refreshExpiresIn: number; // seconds
}

export interface LoginResponse extends TokenResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
    type: string;
    roles: string[];
  };
}

export interface MfaRequiredResponse {
  mfaRequired: true;
  mfaToken: string; // Temporary token to complete MFA
  mfaMethod: 'totp' | 'sms' | 'email';
  expiresIn: number; // seconds
}

export interface RefreshResponse extends TokenResponse {}

export interface LogoutResponse {
  success: true;
  message: string;
}

export interface PasswordResetResponse {
  success: true;
  message: string;
}

// Type guard for MFA response
export function isMfaRequired(
  response: LoginResponse | MfaRequiredResponse
): response is MfaRequiredResponse {
  return 'mfaRequired' in response && response.mfaRequired === true;
}
