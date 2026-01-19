import { RoleAssignment } from '../../domain/entities/RoleAssignment';
import { AssignRoleDTO } from '../../dto/request/AuthorizationDTO';
import { PaginatedResult } from '../../shared/types';

export interface UpdateRoleAssignmentDTO {
  status?: 'active' | 'inactive' | 'expired';
  expiresAt?: string;
  reason?: string;
}

export interface ListRoleAssignmentsParams {
  limit?: number;
  cursor?: string;
  status?: string;
}

export interface IRoleAssignmentRepository {
  create(tenantId: string, data: AssignRoleDTO, grantedBy: string): Promise<RoleAssignment>;
  getById(tenantId: string, id: string): Promise<RoleAssignment | null>;
  update(tenantId: string, id: string, data: UpdateRoleAssignmentDTO, updatedBy: string): Promise<RoleAssignment>;
  delete(tenantId: string, id: string): Promise<void>;
  list(tenantId: string, params?: { limit?: number; cursor?: string }): Promise<PaginatedResult<RoleAssignment>>;

  getByUserId(tenantId: string, userId: string): Promise<RoleAssignment[]>;
  getByUserIdAndScope(tenantId: string, userId: string, scope: string): Promise<RoleAssignment[]>;
  getActiveByUserId(tenantId: string, userId: string): Promise<RoleAssignment[]>;
  getByRoleKey(tenantId: string, roleKey: string): Promise<RoleAssignment[]>;
  revokeByUserId(tenantId: string, userId: string, revokedBy: string): Promise<void>;
  revokeByRoleKey(tenantId: string, roleKey: string, revokedBy: string): Promise<void>;
  expireOldAssignments(tenantId: string): Promise<number>;
}
