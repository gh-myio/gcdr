import { BaseEntity } from '../../shared/types';

export type AssignmentStatus = 'active' | 'inactive' | 'expired';

export interface RoleAssignment extends BaseEntity {
  userId: string;
  roleKey: string;
  scope: string;
  status: AssignmentStatus;
  expiresAt?: string;
  grantedBy: string;
  grantedAt: string;
  reason?: string;
}
