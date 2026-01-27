// =============================================================================
// RFC-0009: Events Audit Logs - Type Definitions
// =============================================================================

/**
 * Event types for all auditable actions in GCDR
 */
export enum EventType {
  // === Customers ===
  CUSTOMER_CREATED = 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED = 'CUSTOMER_UPDATED',
  CUSTOMER_DELETED = 'CUSTOMER_DELETED',
  CUSTOMER_VIEWED = 'CUSTOMER_VIEWED',
  CUSTOMER_LIST_VIEWED = 'CUSTOMER_LIST_VIEWED',
  CUSTOMER_MOVED = 'CUSTOMER_MOVED',

  // === Users ===
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_INVITED = 'USER_INVITED',
  USER_ACTIVATED = 'USER_ACTIVATED',
  USER_SUSPENDED = 'USER_SUSPENDED',

  // === Assets ===
  ASSET_CREATED = 'ASSET_CREATED',
  ASSET_UPDATED = 'ASSET_UPDATED',
  ASSET_DELETED = 'ASSET_DELETED',
  ASSET_MOVED = 'ASSET_MOVED',

  // === Devices ===
  DEVICE_CREATED = 'DEVICE_CREATED',
  DEVICE_UPDATED = 'DEVICE_UPDATED',
  DEVICE_DELETED = 'DEVICE_DELETED',
  DEVICE_MOVED = 'DEVICE_MOVED',
  DEVICE_STATUS_CHANGED = 'DEVICE_STATUS_CHANGED',
  DEVICE_CONNECTIVITY_CHANGED = 'DEVICE_CONNECTIVITY_CHANGED',

  // === Rules ===
  RULE_CREATED = 'RULE_CREATED',
  RULE_UPDATED = 'RULE_UPDATED',
  RULE_DELETED = 'RULE_DELETED',
  RULE_ENABLED = 'RULE_ENABLED',
  RULE_DISABLED = 'RULE_DISABLED',
  RULE_TRIGGERED = 'RULE_TRIGGERED',

  // === Roles & Policies ===
  ROLE_CREATED = 'ROLE_CREATED',
  ROLE_UPDATED = 'ROLE_UPDATED',
  ROLE_DELETED = 'ROLE_DELETED',
  ROLE_ASSIGNED = 'ROLE_ASSIGNED',
  ROLE_REVOKED = 'ROLE_REVOKED',
  POLICY_CREATED = 'POLICY_CREATED',
  POLICY_UPDATED = 'POLICY_UPDATED',
  POLICY_DELETED = 'POLICY_DELETED',

  // === Partners ===
  PARTNER_REGISTERED = 'PARTNER_REGISTERED',
  PARTNER_APPROVED = 'PARTNER_APPROVED',
  PARTNER_REJECTED = 'PARTNER_REJECTED',
  PARTNER_SUSPENDED = 'PARTNER_SUSPENDED',
  PARTNER_ACTIVATED = 'PARTNER_ACTIVATED',

  // === API Keys ===
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
  API_KEY_USED = 'API_KEY_USED',

  // === Integrations ===
  PACKAGE_SUBSCRIBED = 'PACKAGE_SUBSCRIBED',
  PACKAGE_UNSUBSCRIBED = 'PACKAGE_UNSUBSCRIBED',
  PACKAGE_PUBLISHED = 'PACKAGE_PUBLISHED',

  // === Auth ===
  AUTH_LOGIN_SUCCESS = 'AUTH_LOGIN_SUCCESS',
  AUTH_LOGIN_FAILED = 'AUTH_LOGIN_FAILED',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_TOKEN_REFRESHED = 'AUTH_TOKEN_REFRESHED',
  AUTH_PASSWORD_CHANGED = 'AUTH_PASSWORD_CHANGED',
  AUTH_PASSWORD_RESET_REQUESTED = 'AUTH_PASSWORD_RESET_REQUESTED',
  AUTH_MFA_ENABLED = 'AUTH_MFA_ENABLED',
  AUTH_MFA_DISABLED = 'AUTH_MFA_DISABLED',
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',

  // === Centrals ===
  CENTRAL_CREATED = 'CENTRAL_CREATED',
  CENTRAL_UPDATED = 'CENTRAL_UPDATED',
  CENTRAL_DELETED = 'CENTRAL_DELETED',
  CENTRAL_STATUS_CHANGED = 'CENTRAL_STATUS_CHANGED',

  // === Groups ===
  GROUP_CREATED = 'GROUP_CREATED',
  GROUP_UPDATED = 'GROUP_UPDATED',
  GROUP_DELETED = 'GROUP_DELETED',
  GROUP_MEMBER_ADDED = 'GROUP_MEMBER_ADDED',
  GROUP_MEMBER_REMOVED = 'GROUP_MEMBER_REMOVED',

  // === Look & Feel ===
  THEME_CREATED = 'THEME_CREATED',
  THEME_UPDATED = 'THEME_UPDATED',
  THEME_DELETED = 'THEME_DELETED',
  THEME_SET_DEFAULT = 'THEME_SET_DEFAULT',

  // === Alarm Bundle (GCDR-specific) ===
  ALARM_BUNDLE_GENERATED = 'ALARM_BUNDLE_GENERATED',
  ALARM_BUNDLE_DOWNLOADED = 'ALARM_BUNDLE_DOWNLOADED',

  // === Admin ===
  ADMIN_DATA_EXPORTED = 'ADMIN_DATA_EXPORTED',
  ADMIN_BULK_OPERATION = 'ADMIN_BULK_OPERATION',
}

/**
 * Event categories for grouping audit events
 */
export enum EventCategory {
  ENTITY_CHANGE = 'ENTITY_CHANGE',     // CRUD on entities
  USER_ACTION = 'USER_ACTION',         // User actions (login, export, etc.)
  SYSTEM_EVENT = 'SYSTEM_EVENT',       // Automatic events
  QUERY = 'QUERY',                     // Queries/reads
  AUTH = 'AUTH',                       // Authentication/authorization
  INTEGRATION = 'INTEGRATION',         // Integration events
}

/**
 * Actor types - who performed the action
 */
export enum ActorType {
  USER = 'USER',                       // Authenticated user
  SYSTEM = 'SYSTEM',                   // System/automation
  API_KEY = 'API_KEY',                 // Access via API Key
  SERVICE_ACCOUNT = 'SERVICE_ACCOUNT', // Service account
  ANONYMOUS = 'ANONYMOUS',             // Not authenticated
}

/**
 * Action types for CRUD operations
 */
export enum ActionType {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXECUTE = 'EXECUTE',
}

/**
 * Audit levels for controlling log verbosity and retention
 */
export enum AuditLevel {
  MINIMAL = 'MINIMAL',     // Critical actions only (365 days retention)
  STANDARD = 'STANDARD',   // Normal operations (180 days retention)
  VERBOSE = 'VERBOSE',     // Queries and reads (90 days retention)
  DEBUG = 'DEBUG',         // Everything (30 days retention)
}

/**
 * Audit level numeric values for comparison
 */
export const AuditLevelValue: Record<AuditLevel, number> = {
  [AuditLevel.MINIMAL]: 1,
  [AuditLevel.STANDARD]: 2,
  [AuditLevel.VERBOSE]: 3,
  [AuditLevel.DEBUG]: 4,
};

/**
 * Retention days by audit level
 */
export const AuditRetentionDays: Record<AuditLevel, number> = {
  [AuditLevel.MINIMAL]: 365,
  [AuditLevel.STANDARD]: 180,
  [AuditLevel.VERBOSE]: 90,
  [AuditLevel.DEBUG]: 30,
};

/**
 * Audit log entry interface
 */
export interface AuditLogEntry {
  id: string;
  tenantId: string;

  // Event
  eventType: EventType;
  eventCategory: EventCategory;
  auditLevel: AuditLevel;
  description?: string;
  action: ActionType;

  // Entity (target of action)
  entityType: string;
  entityId?: string;
  customerId?: string;

  // Actor (who performed)
  userId?: string;
  userEmail?: string;
  actorType: ActorType;

  // State before/after (sanitized)
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;

  // Request context
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  httpMethod?: string;
  httpPath?: string;

  // Result
  statusCode?: number;
  errorMessage?: string;
  durationMs?: number;

  // Flexible metadata
  metadata: Record<string, unknown>;
  externalLink?: string;

  // Timestamp
  createdAt: Date;
}

/**
 * Create audit log input
 */
export type CreateAuditLogInput = Omit<AuditLogEntry, 'id' | 'createdAt'>;

/**
 * Audit log query filters
 */
export interface AuditLogFilters {
  tenantId: string;
  customerId?: string;
  userId?: string;
  eventType?: EventType;
  eventCategory?: EventCategory;
  entityType?: string;
  entityId?: string;
  action?: ActionType;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
  orderBy?: 'createdAt:asc' | 'createdAt:desc';
}
