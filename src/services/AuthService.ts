import * as crypto from 'crypto';
import { User } from '../domain/entities/User';
import { UserService, userService as defaultUserService } from './UserService';
import { UnauthorizedError, ValidationError } from '../shared/errors/AppError';
import { eventService } from '../infrastructure/events/EventService';
import { EventType } from '../shared/events/eventTypes';
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
  aud: string;
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

// JWT functions
function createJWT(payload: object, expiresIn: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
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
    tenantId: string,
    email: string,
    password: string,
    mfaCode?: string,
    ip?: string,
    deviceInfo?: string
  ): Promise<LoginResponse | MfaRequiredResponse> {
    // Find user by email
    let user: User;
    try {
      user = await this.userService.getByEmail(tenantId, email);
    } catch {
      // Record failed attempt even if user not found (prevent enumeration)
      throw new UnauthorizedError('Credenciais inválidas');
    }

    // Check if user is locked
    if (user.security.lockedUntil) {
      const lockedUntil = new Date(user.security.lockedUntil);
      if (lockedUntil > new Date()) {
        throw new UnauthorizedError(
          `Conta bloqueada até ${lockedUntil.toLocaleString('pt-BR')}`
        );
      }
    }

    // Check user status
    if (user.status === 'INACTIVE') {
      throw new UnauthorizedError('Conta desativada');
    }
    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedError('Conta suspensa');
    }
    if (user.status === 'PENDING_VERIFICATION') {
      throw new UnauthorizedError('Email não verificado');
    }

    // Verify password
    if (!user.security.passwordHash || !verifyPassword(password, user.security.passwordHash)) {
      await this.userService.recordLoginAttempt(tenantId, email, false, ip || 'unknown');
      throw new UnauthorizedError('Credenciais inválidas');
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

    // Record successful login
    await this.userService.recordLoginAttempt(tenantId, email, true, ip || 'unknown');

    // Generate tokens
    const tokens = await this.generateTokens(user, tenantId);

    // Publish login event
    await eventService.publish(EventType.USER_LOGIN, {
      tenantId,
      entityType: 'user',
      entityId: user.id,
      action: 'login',
      data: {
        email: user.email,
        ip,
        deviceInfo,
      },
      actor: { userId: user.id, type: 'user' },
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.profile.displayName || `${user.profile.firstName} ${user.profile.lastName}`,
        type: user.type,
        roles: [], // TODO: Get roles from authorization service
      },
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

    // Generate tokens
    const tokens = await this.generateTokens(user, tenantId);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.profile.displayName || `${user.profile.firstName} ${user.profile.lastName}`,
        type: user.type,
        roles: [],
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
      throw new UnauthorizedError('Refresh token revogado');
    }

    // Get user to ensure they still exist and are active
    const user = await this.userService.getById(tenantId, payload.sub);
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Conta não está ativa');
    }

    // Revoke old refresh token
    this.refreshTokens.delete(payload.jti);

    // Generate new tokens
    return this.generateTokens(user, tenantId);
  }

  async logout(tenantId: string, userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const payload = verifyJWT<RefreshTokenPayload>(refreshToken);
      if (payload && payload.jti) {
        this.refreshTokens.delete(payload.jti);
      }
    }

    await eventService.publish(EventType.USER_LOGOUT, {
      tenantId,
      entityType: 'user',
      entityId: userId,
      action: 'logout',
      data: {},
      actor: { userId, type: 'user' },
    });
  }

  async logoutAllDevices(tenantId: string, userId: string): Promise<void> {
    // Remove all refresh tokens for this user
    for (const [tokenId, data] of this.refreshTokens.entries()) {
      if (data.userId === userId && data.tenantId === tenantId) {
        this.refreshTokens.delete(tokenId);
      }
    }

    await eventService.publish(EventType.USER_LOGOUT, {
      tenantId,
      entityType: 'user',
      entityId: userId,
      action: 'logout_all',
      data: { allDevices: true },
      actor: { userId, type: 'user' },
    });
  }

  verifyAccessToken(token: string): JWTPayload | null {
    return verifyJWT<JWTPayload>(token);
  }

  private async generateTokens(user: User, tenantId: string): Promise<TokenResponse> {
    // Generate access token
    const accessToken = createJWT(
      {
        sub: user.id,
        tenant_id: tenantId,
        email: user.email,
        roles: [], // TODO: Get from authorization service
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
