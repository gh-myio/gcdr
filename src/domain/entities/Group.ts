import { BaseEntity, EntityStatus } from '../../shared/types';

/**
 * Group types define what kind of members the group can contain
 */
export type GroupType = 'USER' | 'DEVICE' | 'ASSET' | 'MIXED';

/**
 * Group purpose determines how the group is used in the system
 */
export type GroupPurpose =
  | 'NOTIFICATION'      // For sending notifications/alerts
  | 'ESCALATION'        // For escalation chains
  | 'ACCESS_CONTROL'    // For permission management
  | 'REPORTING'         // For report grouping
  | 'MAINTENANCE'       // For maintenance scheduling
  | 'MONITORING'        // For monitoring dashboards
  | 'CUSTOM';           // Custom purpose

/**
 * Member reference in a group
 */
export interface GroupMember {
  id: string;
  type: 'USER' | 'DEVICE' | 'ASSET';
  name?: string;           // Denormalized for display
  addedAt: string;
  addedBy?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Notification settings for the group
 */
export interface GroupNotificationSettings {
  channels: Array<{
    type: 'EMAIL' | 'SMS' | 'WEBHOOK' | 'SLACK' | 'TEAMS' | 'TELEGRAM' | 'PUSH';
    enabled: boolean;
    config?: Record<string, string>;
  }>;
  schedule?: {
    timezone: string;
    quietHours?: {
      start: string;  // HH:mm
      end: string;    // HH:mm
      days: number[]; // 0-6 (Sunday = 0)
    };
    businessHoursOnly?: boolean;
    businessHours?: {
      start: string;  // HH:mm
      end: string;    // HH:mm
      days: number[]; // 0-6
    };
  };
  escalationDelayMinutes?: number;
  digestEnabled?: boolean;
  digestIntervalMinutes?: number;
}

/**
 * Group hierarchy for nested groups
 */
export interface GroupHierarchy {
  parentGroupId?: string;
  childGroupIds: string[];
  path: string;          // Materialized path for efficient queries
  depth: number;
}

/**
 * Main Group Entity
 */
export interface Group extends BaseEntity {
  // Association
  customerId: string;

  // Basic Info
  name: string;
  displayName: string;
  description?: string;
  code?: string;         // Unique code within customer (e.g., "MANUTENCAO-SP")

  // Type and Purpose
  type: GroupType;
  purposes: GroupPurpose[];

  // Members
  members: GroupMember[];
  memberCount: number;   // Denormalized for efficient queries

  // Hierarchy (optional)
  hierarchy?: GroupHierarchy;

  // Notification Settings (for notification-enabled groups)
  notificationSettings?: GroupNotificationSettings;

  // Configuration
  tags: string[];
  metadata: Record<string, unknown>;

  // Permissions
  visibleToChildCustomers: boolean;  // If true, child customers can see this group
  editableByChildCustomers: boolean; // If true, child customers can modify members

  // Status
  status: EntityStatus;
  deletedAt?: string;
}

/**
 * Summary view for listing groups
 */
export interface GroupSummary {
  id: string;
  tenantId: string;
  customerId: string;
  name: string;
  displayName: string;
  type: GroupType;
  purposes: GroupPurpose[];
  memberCount: number;
  tags: string[];
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create default notification settings
 */
export function createDefaultNotificationSettings(): GroupNotificationSettings {
  return {
    channels: [
      { type: 'EMAIL', enabled: true },
      { type: 'PUSH', enabled: true },
    ],
    digestEnabled: false,
  };
}

/**
 * Create default group hierarchy
 */
export function createDefaultHierarchy(): GroupHierarchy {
  return {
    childGroupIds: [],
    path: '',
    depth: 0,
  };
}

/**
 * Check if group can contain a specific member type
 */
export function canContainMemberType(group: Group, memberType: 'USER' | 'DEVICE' | 'ASSET'): boolean {
  if (group.type === 'MIXED') {
    return true;
  }
  return group.type === memberType;
}

/**
 * Get member IDs by type
 */
export function getMemberIdsByType(group: Group, memberType: 'USER' | 'DEVICE' | 'ASSET'): string[] {
  return group.members
    .filter(m => m.type === memberType)
    .map(m => m.id);
}
