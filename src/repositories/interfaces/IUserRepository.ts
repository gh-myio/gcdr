import { User, UserStatus } from '../../domain/entities/User';
import { CreateUserDTO, UpdateUserDTO, ListUsersDTO } from '../../dto/request/UserDTO';
import { PaginatedResult } from '../../shared/types';

export interface IUserRepository {
  create(tenantId: string, data: CreateUserDTO, createdBy: string): Promise<User>;
  getById(tenantId: string, id: string): Promise<User | null>;
  getByEmail(tenantId: string, email: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  getByUsername(tenantId: string, username: string): Promise<User | null>;
  update(tenantId: string, id: string, data: UpdateUserDTO, updatedBy: string): Promise<User>;
  delete(tenantId: string, id: string): Promise<void>;

  // List and filter
  list(tenantId: string, params: ListUsersDTO): Promise<PaginatedResult<User>>;
  listByCustomer(tenantId: string, customerId: string): Promise<User[]>;
  listByPartner(tenantId: string, partnerId: string): Promise<User[]>;

  // Status management
  updateStatus(tenantId: string, id: string, status: UserStatus, updatedBy: string, reason?: string): Promise<User>;

  // Security operations
  updatePassword(tenantId: string, id: string, passwordHash: string): Promise<void>;
  setPasswordResetToken(tenantId: string, id: string, token: string, expiresAt: string): Promise<void>;
  clearPasswordResetToken(tenantId: string, id: string): Promise<void>;
  setEmailVerificationToken(tenantId: string, id: string, token: string): Promise<void>;
  verifyEmail(tenantId: string, id: string): Promise<void>;
  incrementFailedLoginAttempts(tenantId: string, id: string): Promise<number>;
  resetFailedLoginAttempts(tenantId: string, id: string): Promise<void>;
  lockUser(tenantId: string, id: string, until: string): Promise<void>;
  unlockUser(tenantId: string, id: string): Promise<void>;

  // MFA operations
  enableMfa(tenantId: string, id: string, method: string, secret: string, backupCodes: string[]): Promise<void>;
  disableMfa(tenantId: string, id: string): Promise<void>;

  // Session tracking
  recordLogin(tenantId: string, id: string, ip: string): Promise<void>;
  updateSessionCount(tenantId: string, id: string, count: number): Promise<void>;

  // Invitation
  setInvitationAccepted(tenantId: string, id: string): Promise<void>;
}
