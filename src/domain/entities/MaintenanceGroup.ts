import { BaseEntity } from '../../shared/types';

export interface MaintenanceGroup extends BaseEntity {
  key: string;
  name: string;
  description?: string;
  customerId?: string;
  memberCount: number;
  isActive: boolean;
}

export interface UserMaintenanceGroup {
  id: string;
  tenantId: string;
  userId: string;
  groupId: string;
  assignedAt: string;
  assignedBy?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface MaintenanceGroupMember {
  userId: string;
  userEmail: string;
  userName?: string;
  assignedAt: string;
  assignedBy?: string;
  expiresAt?: string;
}

export interface MaintenanceGroupWithMembers extends MaintenanceGroup {
  members: MaintenanceGroupMember[];
}
