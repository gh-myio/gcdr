// =============================================================================
// GCDR - Drizzle Schema for PostgreSQL
// =============================================================================
// This schema defines all entities for the Global Central Data Registry
// With native CHECK constraints support

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// =============================================================================
// ENUMS
// =============================================================================

export const entityStatusEnum = pgEnum('entity_status', ['ACTIVE', 'INACTIVE', 'DELETED']);

export const customerTypeEnum = pgEnum('customer_type', ['HOLDING', 'COMPANY', 'BRANCH', 'FRANCHISE']);

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION', 'LOCKED']);

export const userTypeEnum = pgEnum('user_type', ['INTERNAL', 'CUSTOMER', 'PARTNER', 'SERVICE_ACCOUNT']);

export const assetTypeEnum = pgEnum('asset_type', ['BUILDING', 'FLOOR', 'ROOM', 'EQUIPMENT', 'ZONE', 'OTHER']);

export const deviceTypeEnum = pgEnum('device_type', ['SENSOR', 'ACTUATOR', 'GATEWAY', 'CONTROLLER', 'METER', 'CAMERA', 'OTHER']);

export const deviceProtocolEnum = pgEnum('device_protocol', ['MQTT', 'HTTP', 'MODBUS', 'BACNET', 'LORAWAN', 'ZIGBEE', 'OTHER']);

export const connectivityStatusEnum = pgEnum('connectivity_status', ['ONLINE', 'OFFLINE', 'UNKNOWN']);

export const partnerStatusEnum = pgEnum('partner_status', ['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED']);

export const ruleTypeEnum = pgEnum('rule_type', ['ALARM_THRESHOLD', 'SLA', 'ESCALATION', 'MAINTENANCE_WINDOW']);

export const rulePriorityEnum = pgEnum('rule_priority', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const scopeTypeEnum = pgEnum('scope_type', ['GLOBAL', 'CUSTOMER', 'ASSET', 'DEVICE']);

export const riskLevelEnum = pgEnum('risk_level', ['low', 'medium', 'high', 'critical']);

export const assignmentStatusEnum = pgEnum('assignment_status', ['active', 'inactive', 'expired']);

export const centralTypeEnum = pgEnum('central_type', ['NODEHUB', 'GATEWAY', 'EDGE_CONTROLLER', 'VIRTUAL']);

export const connectionStatusEnum = pgEnum('connection_status', ['ONLINE', 'OFFLINE', 'DEGRADED', 'MAINTENANCE']);

export const groupTypeEnum = pgEnum('group_type', ['USER', 'DEVICE', 'ASSET', 'MIXED']);

export const integrationTypeEnum = pgEnum('integration_type', ['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL']);

export const packageStatusEnum = pgEnum('package_status', ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'DEPRECATED', 'SUSPENDED']);

export const pricingModelEnum = pgEnum('pricing_model', ['FREE', 'PER_REQUEST', 'MONTHLY', 'ANNUAL', 'CUSTOM']);

// =============================================================================
// CUSTOMERS
// =============================================================================

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  parentCustomerId: uuid('parent_customer_id'),
  path: text('path').notNull(),
  depth: integer('depth').notNull(),

  // Basic Info
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  type: customerTypeEnum('type').notNull(),

  // Contact
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  address: jsonb('address'),

  // Configuration
  settings: jsonb('settings').notNull().default({}),
  theme: jsonb('theme'),
  metadata: jsonb('metadata').notNull().default({}),

  // Status
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  // Indexes
  tenantCodeUnique: uniqueIndex('customers_tenant_code_unique').on(table.tenantId, table.code),
  tenantParentIdx: index('customers_tenant_parent_idx').on(table.tenantId, table.parentCustomerId),
  tenantPathIdx: index('customers_tenant_path_idx').on(table.tenantId, table.path),
  tenantTypeIdx: index('customers_tenant_type_idx').on(table.tenantId, table.type),
  tenantStatusIdx: index('customers_tenant_status_idx').on(table.tenantId, table.status),
}));

// =============================================================================
// USERS
// =============================================================================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  partnerId: uuid('partner_id'),

  // Identity
  email: varchar('email', { length: 255 }).notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  username: varchar('username', { length: 100 }),
  externalId: varchar('external_id', { length: 255 }),

  // Type and Status
  type: userTypeEnum('type').notNull().default('CUSTOMER'),
  status: userStatusEnum('status').notNull().default('PENDING_VERIFICATION'),

  // Profile, Security, Preferences (JSONB for flexibility)
  profile: jsonb('profile').notNull().default({}),
  security: jsonb('security').notNull().default({}),
  preferences: jsonb('preferences').notNull().default({}),

  // Sessions
  activeSessions: integer('active_sessions').notNull().default(0),

  // Invitation
  invitedBy: uuid('invited_by'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  invitationAcceptedAt: timestamp('invitation_accepted_at', { withTimezone: true }),

  // Tags and metadata
  tags: jsonb('tags').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantEmailUnique: uniqueIndex('users_tenant_email_unique').on(table.tenantId, table.email),
  tenantCustomerIdx: index('users_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantStatusIdx: index('users_tenant_status_idx').on(table.tenantId, table.status),
  tenantTypeIdx: index('users_tenant_type_idx').on(table.tenantId, table.type),
}));

// =============================================================================
// ASSETS
// =============================================================================

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  parentAssetId: uuid('parent_asset_id'),
  path: text('path').notNull(),
  depth: integer('depth').notNull(),

  // Basic Info
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  type: assetTypeEnum('type').notNull(),
  description: text('description'),

  // Location and Specs
  location: jsonb('location'),
  specs: jsonb('specs'),

  // Configuration
  tags: jsonb('tags').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),

  // Status
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantCustomerCodeUnique: uniqueIndex('assets_tenant_customer_code_unique').on(table.tenantId, table.customerId, table.code),
  tenantCustomerIdx: index('assets_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantParentIdx: index('assets_tenant_parent_idx').on(table.tenantId, table.parentAssetId),
  tenantPathIdx: index('assets_tenant_path_idx').on(table.tenantId, table.path),
}));

// =============================================================================
// DEVICES
// =============================================================================

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  assetId: uuid('asset_id').notNull().references(() => assets.id),
  customerId: uuid('customer_id').notNull().references(() => customers.id),

  // Basic Info
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  label: varchar('label', { length: 100 }),
  type: deviceTypeEnum('type').notNull(),
  description: text('description'),

  // Identification
  serialNumber: varchar('serial_number', { length: 100 }).notNull(),
  externalId: varchar('external_id', { length: 255 }),

  // Specifications and Connectivity
  specs: jsonb('specs').notNull().default({}),
  connectivityStatus: connectivityStatusEnum('connectivity_status').notNull().default('UNKNOWN'),
  lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
  lastDisconnectedAt: timestamp('last_disconnected_at', { withTimezone: true }),

  // Credentials and Telemetry
  credentials: jsonb('credentials'),
  telemetryConfig: jsonb('telemetry_config'),

  // Configuration
  tags: jsonb('tags').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),
  attributes: jsonb('attributes').notNull().default({}),

  // Status
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantSerialUnique: uniqueIndex('devices_tenant_serial_unique').on(table.tenantId, table.serialNumber),
  tenantAssetIdx: index('devices_tenant_asset_idx').on(table.tenantId, table.assetId),
  tenantCustomerIdx: index('devices_tenant_customer_idx').on(table.tenantId, table.customerId),
  externalIdIdx: index('devices_external_id_idx').on(table.externalId),
}));

// =============================================================================
// PARTNERS
// =============================================================================

export const partners = pgTable('partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  status: partnerStatusEnum('status').notNull().default('PENDING'),

  // Company Info
  companyName: varchar('company_name', { length: 255 }).notNull(),
  companyWebsite: varchar('company_website', { length: 255 }).notNull(),
  companyDescription: text('company_description').notNull(),
  industry: varchar('industry', { length: 100 }).notNull(),
  country: varchar('country', { length: 100 }).notNull(),

  // Contact
  contactName: varchar('contact_name', { length: 255 }).notNull(),
  contactEmail: varchar('contact_email', { length: 255 }).notNull(),
  contactPhone: varchar('contact_phone', { length: 50 }),

  // Technical
  technicalContactEmail: varchar('technical_contact_email', { length: 255 }).notNull(),
  webhookUrl: varchar('webhook_url', { length: 500 }),
  ipWhitelist: jsonb('ip_whitelist').notNull().default([]),

  // API Access
  apiKeys: jsonb('api_keys').notNull().default([]),
  oauthClients: jsonb('oauth_clients').notNull().default([]),
  webhooks: jsonb('webhooks').notNull().default([]),
  scopes: jsonb('scopes').notNull().default([]),

  // Limits
  rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(100),
  rateLimitPerDay: integer('rate_limit_per_day').notNull().default(10000),
  monthlyQuota: integer('monthly_quota').notNull().default(100000),

  // Packages
  subscribedPackages: jsonb('subscribed_packages').notNull().default([]),
  publishedPackages: jsonb('published_packages').notNull().default([]),

  // Approval/Rejection/Suspension
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by'),
  rejectionReason: text('rejection_reason'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspendedBy: uuid('suspended_by'),
  suspensionReason: text('suspension_reason'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  activatedBy: uuid('activated_by'),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantCompanyUnique: uniqueIndex('partners_tenant_company_unique').on(table.tenantId, table.companyName),
  tenantStatusIdx: index('partners_tenant_status_idx').on(table.tenantId, table.status),
}));

// =============================================================================
// ROLES
// =============================================================================

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  key: varchar('key', { length: 100 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description').notNull(),
  policies: jsonb('policies').notNull().default([]),
  tags: jsonb('tags').notNull().default([]),
  riskLevel: riskLevelEnum('risk_level').notNull().default('low'),
  isSystem: boolean('is_system').notNull().default(false),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantKeyUnique: uniqueIndex('roles_tenant_key_unique').on(table.tenantId, table.key),
  tenantSystemIdx: index('roles_tenant_system_idx').on(table.tenantId, table.isSystem),
}));

// =============================================================================
// POLICIES
// =============================================================================

export const policies = pgTable('policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  key: varchar('key', { length: 100 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description').notNull(),
  allow: jsonb('allow').notNull().default([]),
  deny: jsonb('deny').notNull().default([]),
  conditions: jsonb('conditions'),
  riskLevel: riskLevelEnum('risk_level').notNull().default('low'),
  isSystem: boolean('is_system').notNull().default(false),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantKeyUnique: uniqueIndex('policies_tenant_key_unique').on(table.tenantId, table.key),
  tenantSystemIdx: index('policies_tenant_system_idx').on(table.tenantId, table.isSystem),
}));

// =============================================================================
// ROLE ASSIGNMENTS
// =============================================================================

export const roleAssignments = pgTable('role_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  userId: uuid('user_id').notNull().references(() => users.id),
  roleKey: varchar('role_key', { length: 100 }).notNull(),
  scope: text('scope').notNull(),
  status: assignmentStatusEnum('status').notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  grantedBy: uuid('granted_by').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
  reason: text('reason'),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantUserRoleScopeUnique: uniqueIndex('role_assignments_unique').on(table.tenantId, table.userId, table.roleKey, table.scope),
  tenantUserIdx: index('role_assignments_tenant_user_idx').on(table.tenantId, table.userId),
  tenantRoleIdx: index('role_assignments_tenant_role_idx').on(table.tenantId, table.roleKey),
  tenantStatusIdx: index('role_assignments_tenant_status_idx').on(table.tenantId, table.status),
}));

// =============================================================================
// RULES - WITH CHECK CONSTRAINTS
// =============================================================================

export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),

  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  type: ruleTypeEnum('type').notNull(),
  priority: rulePriorityEnum('priority').notNull().default('MEDIUM'),

  // Scope - using enum for better querying
  scopeType: scopeTypeEnum('scope_type').notNull().default('GLOBAL'),
  scopeEntityId: uuid('scope_entity_id'),
  scopeInherited: boolean('scope_inherited').notNull().default(false),

  // Type-specific configuration (JSONB)
  alarmConfig: jsonb('alarm_config'),
  slaConfig: jsonb('sla_config'),
  escalationConfig: jsonb('escalation_config'),
  maintenanceConfig: jsonb('maintenance_config'),

  // Notification settings
  notificationChannels: jsonb('notification_channels').notNull().default([]),

  // Tags
  tags: jsonb('tags').notNull().default([]),

  // Status
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  enabled: boolean('enabled').notNull().default(true),

  // Metadata
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  triggerCount: integer('trigger_count').notNull().default(0),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  // Indexes
  tenantCustomerIdx: index('rules_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantTypeIdx: index('rules_tenant_type_idx').on(table.tenantId, table.type),
  tenantPriorityIdx: index('rules_tenant_priority_idx').on(table.tenantId, table.priority),
  tenantEnabledIdx: index('rules_tenant_enabled_idx').on(table.tenantId, table.enabled),
  tenantScopeIdx: index('rules_tenant_scope_idx').on(table.tenantId, table.scopeType),

  // CHECK CONSTRAINTS - Validate config based on type
  validAlarmConfig: check(
    'valid_alarm_config',
    sql`${table.type} != 'ALARM_THRESHOLD' OR ${table.alarmConfig} IS NOT NULL`
  ),
  validSlaConfig: check(
    'valid_sla_config',
    sql`${table.type} != 'SLA' OR ${table.slaConfig} IS NOT NULL`
  ),
  validEscalationConfig: check(
    'valid_escalation_config',
    sql`${table.type} != 'ESCALATION' OR ${table.escalationConfig} IS NOT NULL`
  ),
  validMaintenanceConfig: check(
    'valid_maintenance_config',
    sql`${table.type} != 'MAINTENANCE_WINDOW' OR ${table.maintenanceConfig} IS NOT NULL`
  ),
  // Scope entity validation
  validScopeEntity: check(
    'valid_scope_entity',
    sql`${table.scopeType} = 'GLOBAL' OR ${table.scopeEntityId} IS NOT NULL`
  ),
}));

// =============================================================================
// CENTRALS
// =============================================================================

export const centrals = pgTable('centrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  assetId: uuid('asset_id').notNull().references(() => assets.id),

  // Basic Info
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  serialNumber: varchar('serial_number', { length: 100 }).notNull(),
  type: centralTypeEnum('type').notNull(),

  // Status
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  connectionStatus: connectionStatusEnum('connection_status').notNull().default('OFFLINE'),

  // Version
  firmwareVersion: varchar('firmware_version', { length: 50 }).notNull(),
  softwareVersion: varchar('software_version', { length: 50 }).notNull(),
  lastUpdateAt: timestamp('last_update_at', { withTimezone: true }),

  // Configuration and Stats
  config: jsonb('config').notNull().default({}),
  stats: jsonb('stats').notNull().default({}),
  location: jsonb('location'),

  // Tags
  tags: jsonb('tags').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantSerialUnique: uniqueIndex('centrals_tenant_serial_unique').on(table.tenantId, table.serialNumber),
  tenantCustomerIdx: index('centrals_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantAssetIdx: index('centrals_tenant_asset_idx').on(table.tenantId, table.assetId),
}));

// =============================================================================
// GROUPS
// =============================================================================

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),

  // Basic Info
  name: varchar('name', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  code: varchar('code', { length: 50 }),

  // Type and Purpose
  type: groupTypeEnum('type').notNull(),
  purposes: jsonb('purposes').notNull().default([]),

  // Members
  members: jsonb('members').notNull().default([]),
  memberCount: integer('member_count').notNull().default(0),

  // Hierarchy and Notifications
  hierarchy: jsonb('hierarchy'),
  notificationSettings: jsonb('notification_settings'),

  // Configuration
  tags: jsonb('tags').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),

  // Permissions
  visibleToChildCustomers: boolean('visible_to_child_customers').notNull().default(false),
  editableByChildCustomers: boolean('editable_by_child_customers').notNull().default(false),

  // Status
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantCustomerCodeUnique: uniqueIndex('groups_tenant_customer_code_unique').on(table.tenantId, table.customerId, table.code),
  tenantCustomerIdx: index('groups_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantTypeIdx: index('groups_tenant_type_idx').on(table.tenantId, table.type),
}));

// =============================================================================
// LOOK AND FEEL
// =============================================================================

export const lookAndFeels = pgTable('look_and_feels', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),

  // Basic Info
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isDefault: boolean('is_default').notNull().default(false),

  // Theme Mode
  mode: varchar('mode', { length: 20 }).notNull().default('light'),

  // Colors and Typography
  colors: jsonb('colors').notNull().default({}),
  darkModeColors: jsonb('dark_mode_colors'),
  typography: jsonb('typography').notNull().default({}),

  // Logos and Branding
  logo: jsonb('logo').notNull().default({}),
  brandName: varchar('brand_name', { length: 255 }),
  tagline: varchar('tagline', { length: 500 }),

  // Layout and Components
  layout: jsonb('layout').notNull().default({}),
  components: jsonb('components').notNull().default({}),
  customCss: jsonb('custom_css'),

  // Inheritance
  inheritFromParent: boolean('inherit_from_parent').notNull().default(true),
  parentThemeId: uuid('parent_theme_id'),

  // Metadata
  metadata: jsonb('metadata').notNull().default({}),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantCustomerIdx: index('look_and_feels_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantDefaultIdx: index('look_and_feels_tenant_default_idx').on(table.tenantId, table.isDefault),
}));

// =============================================================================
// CUSTOMER API KEYS
// =============================================================================

export const customerApiKeys = pgTable('customer_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),

  // Key data
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),

  // Info
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  scopes: jsonb('scopes').notNull().default([]),

  // Expiration
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Usage tracking
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  lastUsedIp: varchar('last_used_ip', { length: 45 }),
  usageCount: integer('usage_count').notNull().default(0),

  // Status
  isActive: boolean('is_active').notNull().default(true),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  keyHashUnique: uniqueIndex('customer_api_keys_hash_unique').on(table.keyHash),
  tenantCustomerIdx: index('customer_api_keys_tenant_customer_idx').on(table.tenantId, table.customerId),
  keyPrefixIdx: index('customer_api_keys_prefix_idx').on(table.keyPrefix),
  isActiveIdx: index('customer_api_keys_active_idx').on(table.isActive),
}));

// =============================================================================
// INTEGRATION PACKAGES
// =============================================================================

export const integrationPackages = pgTable('integration_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // Basic Info
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull(),
  description: text('description').notNull(),
  longDescription: text('long_description'),
  category: varchar('category', { length: 50 }).notNull(),
  tags: jsonb('tags').notNull().default([]),
  iconUrl: varchar('icon_url', { length: 500 }),
  documentationUrl: varchar('documentation_url', { length: 500 }),

  // Type and Status
  type: integrationTypeEnum('type').notNull(),
  status: packageStatusEnum('status').notNull().default('DRAFT'),
  currentVersion: varchar('current_version', { length: 50 }).notNull(),
  versions: jsonb('versions').notNull().default([]),

  // Publisher
  publisherId: uuid('publisher_id').notNull().references(() => partners.id),
  publisherName: varchar('publisher_name', { length: 255 }).notNull(),
  verified: boolean('verified').notNull().default(false),

  // Technical Config
  scopes: jsonb('scopes').notNull().default([]),
  capabilities: jsonb('capabilities').notNull().default([]),
  endpoints: jsonb('endpoints').notNull().default([]),
  events: jsonb('events').notNull().default([]),
  auth: jsonb('auth').notNull().default({}),
  rateLimits: jsonb('rate_limits').notNull().default({}),

  // Subscription
  pricing: jsonb('pricing').notNull().default({}),
  subscriberCount: integer('subscriber_count').notNull().default(0),

  // Review
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by'),
  rejectionReason: text('rejection_reason'),

  // Timestamps
  publishedAt: timestamp('published_at', { withTimezone: true }),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantSlugUnique: uniqueIndex('integration_packages_tenant_slug_unique').on(table.tenantId, table.slug),
  tenantStatusIdx: index('integration_packages_tenant_status_idx').on(table.tenantId, table.status),
  tenantCategoryIdx: index('integration_packages_tenant_category_idx').on(table.tenantId, table.category),
  tenantPublisherIdx: index('integration_packages_tenant_publisher_idx').on(table.tenantId, table.publisherId),
}));

// =============================================================================
// PACKAGE SUBSCRIPTIONS
// =============================================================================

export const packageSubscriptions = pgTable('package_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  packageId: uuid('package_id').notNull().references(() => integrationPackages.id),
  packageVersion: varchar('package_version', { length: 50 }).notNull(),
  subscriberId: uuid('subscriber_id').notNull(),
  subscriberType: varchar('subscriber_type', { length: 20 }).notNull(),

  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),

  subscribedAt: timestamp('subscribed_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  config: jsonb('config'),
  usageStats: jsonb('usage_stats').notNull().default({}),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  packageSubscriberUnique: uniqueIndex('package_subscriptions_unique').on(table.packageId, table.subscriberId),
  tenantSubscriberIdx: index('package_subscriptions_tenant_subscriber_idx').on(table.tenantId, table.subscriberId),
  tenantStatusIdx: index('package_subscriptions_tenant_status_idx').on(table.tenantId, table.status),
}));

// =============================================================================
// AUDIT LOGS
// =============================================================================

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // Event info
  eventType: varchar('event_type', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  action: varchar('action', { length: 20 }).notNull(),

  // Actor
  userId: uuid('user_id'),
  userEmail: varchar('user_email', { length: 255 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),

  // Changes
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),

  // Context
  requestId: uuid('request_id'),
  metadata: jsonb('metadata').notNull().default({}),

  // Timestamp
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantEntityIdx: index('audit_logs_tenant_entity_idx').on(table.tenantId, table.entityType, table.entityId),
  tenantUserIdx: index('audit_logs_tenant_user_idx').on(table.tenantId, table.userId),
  tenantCreatedIdx: index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
  tenantEventTypeIdx: index('audit_logs_tenant_event_type_idx').on(table.tenantId, table.eventType),
}));
