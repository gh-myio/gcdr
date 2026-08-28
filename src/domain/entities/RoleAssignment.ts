import { BaseEntity } from '../../shared/types';

export type AssignmentStatus = 'active' | 'inactive' | 'expired';

export interface RoleAssignment extends BaseEntity {
  userId: string;
  roleKey: string;
  scope: string;
  /**
   * Human-readable name of the scoped entity (e.g. the customer's name for a
   * `customer:<uuid>` scope). Resolved on read by AuthorizationService — never
   * persisted; UIs fall back to the raw scope when absent.
   */
  scopeName?: string;
  status: AssignmentStatus;
  expiresAt?: string;
  grantedBy: string;
  grantedAt: string;
  reason?: string;
}
