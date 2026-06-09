import * as crypto from 'crypto';
import { User } from '../domain/entities/User';
import { Customer } from '../domain/entities/Customer';
import { UserService, userService as defaultUserService } from './UserService';
import { UnauthorizedError, ValidationError } from '../shared/errors/AppError';
import { registrationService } from './RegistrationService';
import { authorizationService } from './AuthorizationService';
import { userRepository } from '../repositories/UserRepository';
import { customerRepository } from '../repositories/CustomerRepository';
import { pinLookupToken, pinVerify } from './wo/WoPinService';

// RFC-0011: Configuration for account lockout
const MAX_FAILED_LOGIN_ATTEMPTS = 6;
import {
  LoginResponse,
  MfaRequiredResponse,
  TokenResponse,
} from '../dto/response/AuthResponseDTO';
import { config } from '../shared/config/Config';

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production';
const JWT_ISSUER = process.env.JWT_ISSUER || 'gcdr';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'gcdr-api';
const ACCESS_TOKEN_EXPIRY = 3600; // 1 hour in seconds
const REFRESH_TOKEN_EXPIRY = 604800; // 7 days in seconds
const MFA_TOKEN_EXPIRY = 300; // 5 minutes in seconds

interface JWTPayload {
  sub: string;
  tenant_id: string;
  email: string;
  roles: string[];
  type: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

interface RefreshTokenPayload {
  sub: string;
  tenant_id: string;
  jti: string; // unique token id
  iat: number;
  exp: number;
  type: 'refresh';
}

interface MfaTokenPayload {
  sub: string;
  tenant_id: string;
  iat: number;
  exp: number;
  type: 'mfa';
}

// Simple base64url encoding/decoding
function base64UrlEncode(input: Buffer | string): string {
  const str = typeof input === 'string' ? input : input.toString('base64');
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(input: string): Buffer {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = 4 - (base64.length % 4);
  if (padding !== 4) {
    base64 += '='.repeat(padding);
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Parse JWT_AUDIENCE env variable into string or array
 * Supports comma-separated values for multiple audiences (RFC 7519 Section 4.1.3)
 */
function parseAudience(audience: string): string | string[] {
  const parts = audience.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length === 1 ? parts[0]! : parts;
}

// JWT functions
function createJWT(payload: object, expiresIn: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
    iss: JWT_ISSUER,
    aud: parseAudience(JWT_AUDIENCE),
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(fullPayload)));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest();

  const signatureB64 = base64UrlEncode(signature);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

function verifyJWT<T>(token: string): T | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [header, payload, signature] = parts;
    if (!header || !payload || !signature) {
      return null;
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest();

    const actualSignature = base64UrlDecode(signature);

    if (expectedSignature.length !== actualSignature.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(expectedSignature, actualSignature)) {
      return null;
    }

    // Decode payload
    const decoded = JSON.parse(base64UrlDecode(payload).toString('utf-8')) as T & {
      exp: number;
    };

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp < now) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

function generateTokenId(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Simple TOTP verification (in production, use a proper library)
function verifyTOTP(secret: string, code: string): boolean {
  // This is a simplified implementation
  // In production, use speakeasy or otplib
  const counter = Math.floor(Date.now() / 30000);

  for (let i = -1; i <= 1; i++) {
    const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex'));
    hmac.update(Buffer.from([(counter + i) >> 24, (counter + i) >> 16, (counter + i) >> 8, counter + i]));
    const hash = hmac.digest();
    const offset = hash[hash.length - 1]! & 0xf;
    const binary =
      ((hash[offset]! & 0x7f) << 24) |
      ((hash[offset + 1]! & 0xff) << 16) |
      ((hash[offset + 2]! & 0xff) << 8) |
      (hash[offset + 3]! & 0xff);
    const otp = (binary % 1000000).toString().padStart(6, '0');
    if (otp === code) {
      return true;
    }
  }
  return false;
}

export class AuthService {
  private userService: UserService;
  // In production, store refresh tokens in Redis or DynamoDB
  private refreshTokens: Map<string, { userId: string; tenantId: string; expiresAt: number }> =
    new Map();

  constructor(userService?: UserService) {
    this.userService = userService || defaultUserService;
  }

  async login(
    email: string,
    password: string,
    mfaCode?: string,
    ip?: string,
    deviceInfo?: string
  ): Promise<LoginResponse | MfaRequiredResponse> {
    // Find user by email (tenant-independent)
    let user: User;
    try {
      user = await this.userService.findByEmail(email);
    } catch {
      // Record failed attempt even if user not found (prevent enumeration)
      throw new UnauthorizedError('Credenciais inválidas');
    }

    const tenantId = user.tenantId;

    // RFC-0011: Check user status with new states
    switch (user.status) {
      case 'UNVERIFIED':
        throw new UnauthorizedError('Email não verificado. Por favor, verifique seu email.');

      case 'PENDING_APPROVAL':
        throw new UnauthorizedError('Seu cadastro está aguardando aprovação.');

      case 'INACTIVE':
        throw new UnauthorizedError('Conta desativada. Entre em contato com o suporte.');

      case 'LOCKED':
        throw new UnauthorizedError(
          'Conta bloqueada devido a tentativas de login incorretas. Redefina sua senha para desbloquear.'
        );

      case 'ACTIVE':
        // Continue with login
        break;

      default:
        throw new UnauthorizedError('Status de conta inválido');
    }

    // Legacy check for lockedUntil (backward compatibility)
    if (user.security.lockedUntil) {
      const lockedUntil = new Date(user.security.lockedUntil);
      if (lockedUntil > new Date()) {
        throw new UnauthorizedError(
          `Conta bloqueada até ${lockedUntil.toLocaleString('pt-BR')}`
        );
      }
    }

    // Verify password
    if (!user.security.passwordHash || !verifyPassword(password, user.security.passwordHash)) {
      // RFC-0011: Record failed attempt with lockout logic
      try {
        const attempts = await registrationService.recordFailedLogin(tenantId, user.id, ip || 'unknown');
        const remaining = MAX_FAILED_LOGIN_ATTEMPTS - attempts;

        if (remaining <= 0) {
          throw new UnauthorizedError(
            'Conta bloqueada devido a tentativas de login incorretas. Redefina sua senha para desbloquear.'
          );
        }

        throw new UnauthorizedError(`Credenciais inválidas. ${remaining} tentativas restantes.`);
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          throw err;
        }
        // Fallback to original behavior
        await this.userService.recordLoginAttempt(tenantId, email, false, ip || 'unknown');
        throw new UnauthorizedError('Credenciais inválidas');
      }
    }

    // Check MFA if enabled
    if (user.security.mfaEnabled) {
      if (!mfaCode) {
        // Return MFA required response
        const mfaToken = this.createMfaToken(user.id, tenantId);
        return {
          mfaRequired: true,
          mfaToken,
          mfaMethod: user.security.mfaMethod || 'totp',
          expiresIn: MFA_TOKEN_EXPIRY,
        };
      }

      // Verify MFA code
      if (!this.verifyMfaCode(user, mfaCode)) {
        await this.userService.recordLoginAttempt(tenantId, email, false, ip || 'unknown');
        throw new UnauthorizedError('Código MFA inválido');
      }
    }

    // RFC-0011: Record successful login (resets failed attempts)
    await registrationService.recordSuccessfulLogin(tenantId, user.id, ip || 'unknown');

    // Get user's roles from authorization service
    const roles = await authorizationService.getUserRoleKeys(tenantId, user.id);

    // Generate tokens
    const tokens = await this.generateTokens(user, tenantId, roles);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.profile.displayName || `${user.profile.firstName} ${user.profile.lastName}`,
        type: user.type,
        roles,
      },
    };
  }

  /**
   * RFC-0032 — Field-operator login by 4-digit PIN.
   *
   * Flow:
   *   1. Compute deterministic HMAC lookup token for (tenantId, pin).
   *   2. SELECT user by (tenantId, wo_field_pin_lookup) — O(1) via partial unique index.
   *   3. Defence-in-depth: bcrypt verify against wo_field_pin_hash.
   *   4. Reject inactive / locked / non-ACTIVE users (same gates as password login).
   *   5. Mint access + refresh JWT (24h access window per RFC).
   *   6. Return the list of QR-enabled customers the operator has access to.
   *
   * Brute-force protection lives in the route layer (operatorPinRateLimiter
   * by IP). Per-user lockout reuses the existing failed-attempt machinery.
   */
  async loginByPin(
    pin: string,
    tenantId: string,
    ip?: string,
  ): Promise<LoginResponse & { customers: Customer[] }> {
    if (!/^\d{4}$/.test(pin)) {
      throw new ValidationError('PIN inválido');
    }
    if (!tenantId) {
      throw new ValidationError('tenantId é obrigatório');
    }

    const lookup = pinLookupToken(tenantId, pin);
    const user = await userRepository.getByWoPinLookup(tenantId, lookup);
    if (!user) {
      throw new UnauthorizedError('PIN inválido');
    }

    // Defence in depth: re-verify against the bcrypt hash. If the lookup
    // column was crafted/leaked but the bcrypt hash doesn't match, reject.
    const ok = await pinVerify(pin, user.woFieldPinHash ?? null);
    if (!ok) {
      throw new UnauthorizedError('PIN inválido');
    }

    switch (user.status) {
      case 'UNVERIFIED':
      case 'PENDING_APPROVAL':
        throw new UnauthorizedError('Usuário pendente de aprovação');
      case 'INACTIVE':
        throw new UnauthorizedError('Usuário desativado');
      case 'LOCKED':
        throw new UnauthorizedError('Usuário bloqueado');
      case 'ACTIVE':
        break;
      default:
        throw new UnauthorizedError('Status de usuário inválido');
    }

    if (user.security.lockedUntil) {
      const lockedUntil = new Date(user.security.lockedUntil);
      if (lockedUntil > new Date()) {
        throw new UnauthorizedError('Usuário temporariamente bloqueado');
      }
    }

    await registrationService.recordSuccessfulLogin(tenantId, user.id, ip || 'unknown');

    const roles = await authorizationService.getUserRoleKeys(tenantId, user.id);
    const tokens = await this.generateTokens(user, tenantId, roles);
    const customers = await customerRepository.listWoEnabledForUser(tenantId, user.id);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.profile.displayName || `${user.profile.firstName} ${user.profile.lastName}`,
        type: user.type,
        roles,
      },
      customers,
    };
  }

  async verifyMfa(
    tenantId: string,
    mfaToken: string,
    code: string,
    useBackupCode: boolean = false,
    ip?: string
  ): Promise<LoginResponse> {
    // Verify MFA token
    const payload = verifyJWT<MfaTokenPayload>(mfaToken);
    if (!payload || payload.type !== 'mfa' || payload.tenant_id !== tenantId) {
      throw new UnauthorizedError('Token MFA inválido ou expirado');
    }

    // Get user
    const user = await this.userService.getById(tenantId, payload.sub);

    // Verify code
    if (useBackupCode) {
      if (!this.verifyBackupCode(user, code)) {
        throw new UnauthorizedError('Código de backup inválido');
      }
      // TODO: Mark backup code as used
    } else {
      if (!this.verifyMfaCode(user, code)) {
        throw new UnauthorizedError('Código MFA inválido');
      }
    }

    // Record successful login
    await this.userService.recordLoginAttempt(tenantId, user.email, true, ip || 'unknown');

    // Get user's roles from authorization service
    const roles = await authorizationService.getUserRoleKeys(tenantId, user.id);

    // Generate tokens
    const tokens = await this.generateTokens(user, tenantId, roles);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.profile.displayName || `${user.profile.firstName} ${user.profile.lastName}`,
        type: user.type,
        roles,
      },
    };
  }

  async refresh(tenantId: string, refreshToken: string): Promise<TokenResponse> {
    // Verify refresh token
    const payload = verifyJWT<RefreshTokenPayload>(refreshToken);
    if (!payload || payload.type !== 'refresh' || payload.tenant_id !== tenantId) {
      throw new UnauthorizedError('Refresh token inválido ou expirado');
    }

    // Check if token is in our store (not revoked)
    const storedToken = this.refreshTokens.get(payload.jti);
    if (!storedToken || storedToken.userId !== payload.sub) {
      throw new UnauthorizedError(`Refresh token revogado (jti=${payload.jti}, sub=${payload.sub})`);
    }

    // Get user to ensure they still exist and are active
    const user = await this.userService.getById(tenantId, payload.sub);
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Conta não está ativa');
    }

    // Revoke old refresh token
    this.refreshTokens.delete(payload.jti);

    // Get user's roles from authorization service
    const roles = await authorizationService.getUserRoleKeys(tenantId, user.id);

    // Generate new tokens
    return this.generateTokens(user, tenantId, roles);
  }

  async logout(tenantId: string, userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const payload = verifyJWT<RefreshTokenPayload>(refreshToken);
      if (payload && payload.jti) {
        this.refreshTokens.delete(payload.jti);
      }
    }
  }

  async logoutAllDevices(tenantId: string, userId: string): Promise<void> {
    // Remove all refresh tokens for this user
    for (const [tokenId, data] of this.refreshTokens.entries()) {
      if (data.userId === userId && data.tenantId === tenantId) {
        this.refreshTokens.delete(tokenId);
      }
    }
  }

  verifyAccessToken(token: string): JWTPayload | null {
    return verifyJWT<JWTPayload>(token);
  }

  /**
   * RFC-0032 — Viewer JWT for read-only stakeholder access scoped to a
   * single customer. Carries `role:wo-viewer` and `scope:customer:<id>`
   * in the roles claim. Lifetime 1h; no refresh — viewer re-authenticates
   * with the password.
   */
  signViewerJwt(input: { tenantId: string; customerId: string; ip: string }): string {
    return createJWT(
      {
        sub: `wo-viewer:${input.customerId}`,
        tenant_id: input.tenantId,
        email: `viewer-${input.customerId}@viewer.local`,
        roles: [`role:wo-viewer`, `scope:customer:${input.customerId}`],
        type: 'CUSTOMER',
        viewer_customer_id: input.customerId,
      },
      ACCESS_TOKEN_EXPIRY,
    );
  }

  private async generateTokens(user: User, tenantId: string, roles: string[] = []): Promise<TokenResponse> {
    // Generate access token
    const accessToken = createJWT(
      {
        sub: user.id,
        tenant_id: tenantId,
        email: user.email,
        roles,
        type: user.type,
      },
      ACCESS_TOKEN_EXPIRY
    );

    // Generate refresh token
    const tokenId = generateTokenId();
    const refreshToken = createJWT(
      {
        sub: user.id,
        tenant_id: tenantId,
        jti: tokenId,
        type: 'refresh',
      },
      REFRESH_TOKEN_EXPIRY
    );

    // Store refresh token
    this.refreshTokens.set(tokenId, {
      userId: user.id,
      tenantId,
      expiresAt: Date.now() + REFRESH_TOKEN_EXPIRY * 1000,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_EXPIRY,
      refreshExpiresIn: REFRESH_TOKEN_EXPIRY,
    };
  }

  private createMfaToken(userId: string, tenantId: string): string {
    return createJWT(
      {
        sub: userId,
        tenant_id: tenantId,
        type: 'mfa',
      },
      MFA_TOKEN_EXPIRY
    );
  }

  private verifyMfaCode(user: User, code: string): boolean {
    if (!user.security.mfaSecret) {
      return false;
    }

    switch (user.security.mfaMethod) {
      case 'totp':
        return verifyTOTP(user.security.mfaSecret, code);
      case 'sms':
      case 'email':
        // For SMS/Email, the code would be stored temporarily
        // This is a simplified implementation
        return false;
      default:
        return false;
    }
  }

  private verifyBackupCode(user: User, code: string): boolean {
    if (!user.security.mfaBackupCodes) {
      return false;
    }
    return user.security.mfaBackupCodes.includes(code.toUpperCase());
  }
}

export const authService = new AuthService();
