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
  smallint,
  bigint,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// =============================================================================
// ENUMS
// =============================================================================

export const entityStatusEnum = pgEnum('entity_status', ['ACTIVE', 'INACTIVE', 'DELETED']);

export const customerTypeEnum = pgEnum('customer_type', ['HOLDING', 'COMPANY', 'BRANCH', 'FRANCHISE']);

// RFC-0011: Updated user status enum with full lifecycle
export const userStatusEnum = pgEnum('user_status', [
  'UNVERIFIED',        // New registration, email not verified
  'PENDING_APPROVAL',  // Email verified, awaiting admin approval
  'ACTIVE',            // Fully active user
  'INACTIVE',          // Deactivated by admin or rejected
  'LOCKED',            // Locked due to failed login attempts
]);

export const userTypeEnum = pgEnum('user_type', ['INTERNAL', 'CUSTOMER', 'PARTNER', 'SERVICE_ACCOUNT']);

export const assetTypeEnum = pgEnum('asset_type', ['SITE', 'BUILDING', 'FLOOR', 'ROOM', 'EQUIPMENT', 'ZONE', 'LOCATION', 'OTHER']);

export const deviceTypeEnum = pgEnum('device_type', ['SENSOR', 'ACTUATOR', 'GATEWAY', 'CONTROLLER', 'METER', 'CAMERA', 'OUTLET', 'INFRARED', 'OTHER']);

export const deviceProtocolEnum = pgEnum('device_protocol', ['MQTT', 'HTTP', 'MODBUS', 'BACNET', 'LORAWAN', 'ZIGBEE', 'OTHER']);

export const connectivityStatusEnum = pgEnum('connectivity_status', ['ONLINE', 'OFFLINE', 'UNKNOWN']);

export const partnerStatusEnum = pgEnum('partner_status', ['PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'REJECTED']);

export const ruleTypeEnum = pgEnum('rule_type', ['ALARM_THRESHOLD', 'SLA', 'ESCALATION', 'MAINTENANCE_WINDOW', 'DEVICE_OFFLINE', 'NO_CONSUMPTION']);

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

// Simulator enums (RFC-0010)
export const simulatorSessionStatusEnum = pgEnum('simulator_session_status', [
  'PENDING',
  'RUNNING',
  'STOPPED',
  'EXPIRED',
  'ERROR',
]);

// Verification token types (RFC-0011)
export const verificationTokenTypeEnum = pgEnum('verification_token_type', [
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'ACCOUNT_UNLOCK',
]);

// RFC-0013: Access Bundle enums
export const equipmentTypeEnum = pgEnum('equipment_type', [
  'hidrometro',
  'medidor',
  'sensor',
  'termometro',
  'analisador',
  'controlador',
  'gateway',
  'other',
]);

export const locationTypeEnum = pgEnum('location_type', [
  'entry',
  'common_area',
  'stores',
  'internal',
  'external',
  'parking',
  'roof',
  'basement',
  'other',
]);

export const featureAccessTypeEnum = pgEnum('feature_access_type', [
  'guaranteed',
  'granted',
  'conditional',
  'denied',
  'not_granted',
]);

// Audit enums (RFC-0009)
export const eventCategoryEnum = pgEnum('event_category', [
  'ENTITY_CHANGE',
  'USER_ACTION',
  'SYSTEM_EVENT',
  'QUERY',
  'AUTH',
  'INTEGRATION',
]);

export const actorTypeEnum = pgEnum('actor_type', [
  'USER',
  'SYSTEM',
  'API_KEY',
  'SERVICE_ACCOUNT',
  'ANONYMOUS',
]);

export const auditLevelEnum = pgEnum('audit_level', [
  'MINIMAL',
  'STANDARD',
  'VERBOSE',
  'DEBUG',
]);

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

  // External integration
  externalId: varchar('external_id', { length: 255 }),

  // Configuration
  settings: jsonb('settings').notNull().default({}),
  theme: jsonb('theme'),
  metadata: jsonb('metadata').notNull().default({}),
  config: jsonb('config'),

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
  externalIdIdx: index('customers_external_id_idx').on(table.externalId),
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

  // Type and Status
  type: userTypeEnum('type').notNull().default('CUSTOMER'),
  status: userStatusEnum('status').notNull().default('UNVERIFIED'),

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

  // External integrations (ThingsBoard, Freshdesk, App, OS, etc.)
  externalLinks: jsonb('external_links').notNull().default([]),

  // RFC-0032: QR Checker field-operator PIN credentials.
  // woFieldPinLookup = HMAC-SHA256(WO_PIN_PEPPER, tenantId + ':' + pin) — deterministic, fast lookup.
  // woFieldPinHash   = bcrypt(pin) — slow verify.
  woFieldPinLookup: text('wo_field_pin_lookup'),
  woFieldPinHash:   text('wo_field_pin_hash'),

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
// ENTITIES (RFC-0047 — Generic Entity Registry)
// =============================================================================
// Governed type registry + a typed key/value forest with system defaults
// (customer_id NULL) and per-customer overrides. See drizzle/migrations/
// 0049_entities.sql + 0050_entities_triggers.sql and docs/rfcs/RFC-0047-*.

export const entityTypes = pgTable('entity_types', {
  entityType: text('entity_type').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  allowedParentTypes: text('allowed_parent_types').array().notNull().default(sql`'{}'::text[]`),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.tenantId, table.entityType] }),
}));

export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id'),                       // null = system default; set = customer override
  entityType: text('entity_type').notNull(),
  entityKey: text('entity_key').notNull(),
  entityValue: text('entity_value'),
  parentEntityId: uuid('parent_entity_id'),              // self-FK (ON DELETE RESTRICT in migration)
  sortOrder: integer('sort_order').notNull().default(0), // deterministic sibling order; system-locked on is_system rows
  cloneScopeKey: text('clone_scope_key').notNull().default('*'),
  isSystem: boolean('is_system').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  isDeleted: boolean('is_deleted').notNull().default(false),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').notNull(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  // Partial unique indexes — system vs customer namespace, soft-deleted excluded.
  // COALESCE folds the nullable parent (NULLs are otherwise distinct in UNIQUE).
  systemUq: uniqueIndex('entities_system_uq')
    .on(
      table.tenantId,
      sql`COALESCE(${table.parentEntityId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.entityType,
      table.entityKey,
    )
    .where(sql`${table.customerId} IS NULL AND ${table.isDeleted} = false`),
  customerUq: uniqueIndex('entities_customer_uq')
    .on(
      table.tenantId,
      table.customerId,
      sql`COALESCE(${table.parentEntityId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.entityType,
      table.entityKey,
    )
    .where(sql`${table.customerId} IS NOT NULL AND ${table.isDeleted} = false`),
  tenantTypeIdx: index('entities_tenant_type_idx')
    .on(table.tenantId, table.entityType)
    .where(sql`${table.isDeleted} = false`),
  tenantKeyIdx: index('entities_tenant_key_idx')
    .on(table.tenantId, table.entityKey)
    .where(sql`${table.isDeleted} = false`),
  tenantParentIdx: index('entities_tenant_parent_idx')
    .on(table.tenantId, table.parentEntityId, table.sortOrder)
    .where(sql`${table.isDeleted} = false`),
  customerIdx: index('entities_customer_idx')
    .on(table.tenantId, table.customerId)
    .where(sql`${table.isDeleted} = false`),
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
  code: varchar('code', { length: 50 }),
  label: varchar('label', { length: 255 }),
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

  // ==========================================================================
  // RFC-0008: Device Attributes Extension
  // ==========================================================================

  // Modbus Configuration
  slaveId: smallint('slave_id'),  // Modbus slave ID (1-247)
  centralId: uuid('central_id'),  // FK to centrals table (added after centrals definition)

  // RFC-0008 follow-up (migration 0029): channel-centric identity. A board at
  // (central, slave) can expose multiple channels; these distinguish them.
  channel: smallint('channel'),                              // channel index on the board (optional)
  deviceChannelType: varchar('device_channel_type', { length: 100 }),  // e.g. 'lamp', 'presence_sensor' (optional)

  // RFC-0046 Addendum A (DEC-11, migration 0061): explicit meter purpose —
  // ENTRY meters participate in the goals residual allocation for their
  // domain. Never inferred from channel/tags; both-or-neither with meterDomain.
  meterRole: text('meter_role'),      // ENTRY | SUBMETER (nullable = unclassified)
  meterDomain: text('meter_domain'),  // ENERGY | WATER — the domain the role applies to

  // RFC-0054 (DEC-2, migration 0062): explicit tariff category — the join key
  // between a device's consumption and the hourly tariff. Never inferred; a
  // NULL device is excluded from the money overlay and reported as uncategorized.
  tariffCategory: text('tariff_category'),  // COMMON_AREA | SPECIFIC (nullable = unclassified)

  // Identification Extended
  identifier: varchar('identifier', { length: 255 }),  // Human-readable unique identifier
  deviceProfile: varchar('device_profile', { length: 100 }),  // Device profile (e.g., HIDROMETRO_AREA_COMUM)
  deviceType: varchar('device_type', { length: 100 }),  // Specific device type (e.g., 3F_MEDIDOR)

  // RFC-0058: BOX device profile — self-referential membership. A member
  // device points at its enclosure (deviceProfile='BOX') via box_id. A BOX
  // has box_id NULL (BOX_GROUP nesting is deferred). ON DELETE SET NULL:
  // deleting a BOX detaches its members, never deletes them. Profile/tenant/
  // self-reference invariants are enforced in DeviceService (see migration 0066).
  boxId: uuid('box_id').references((): AnyPgColumn => devices.id, { onDelete: 'set null' }),

  // Ingestion Integration
  ingestionId: uuid('ingestion_id'),  // ID in ingestion system
  ingestionGatewayId: uuid('ingestion_gateway_id'),  // Gateway ID in ingestion system

  // Activity Monitoring
  lastActivityTime: timestamp('last_activity_time', { withTimezone: true }),  // Last telemetry received
  lastAlarmTime: timestamp('last_alarm_time', { withTimezone: true }),  // Last alarm triggered

  // RFC-0032: QR Checker addressing fields populated by the field app
  // when scanning QR codes. Distinct from RFC-0008's slaveId/centralId
  // (those are Modbus addresses on the central; these come from the QR
  // payload encoded on the physical device sticker).
  woAddrLow:    smallint('wo_addr_low'),
  woAddrHigh:   smallint('wo_addr_high'),
  woIdentifier: text('wo_identifier'),

}, (table) => ({
  // Existing indexes
  tenantSerialUnique: uniqueIndex('devices_tenant_serial_unique').on(table.tenantId, table.serialNumber),
  tenantAssetIdx: index('devices_tenant_asset_idx').on(table.tenantId, table.assetId),
  tenantCustomerIdx: index('devices_tenant_customer_idx').on(table.tenantId, table.customerId),
  externalIdIdx: index('devices_external_id_idx').on(table.externalId),

  // RFC-0008: New indexes (all with tenant_id for multi-tenant isolation)
  slaveIdIdx: index('devices_slave_id_idx').on(table.tenantId, table.slaveId),
  centralIdIdx: index('devices_central_id_idx').on(table.tenantId, table.centralId),
  identifierIdx: index('devices_identifier_idx').on(table.tenantId, table.identifier),
  deviceProfileIdx: index('devices_device_profile_idx').on(table.tenantId, table.deviceProfile),
  deviceTypeIdx: index('devices_device_type_idx').on(table.tenantId, table.deviceType),
  ingestionIdIdx: index('devices_ingestion_id_idx').on(table.tenantId, table.ingestionId),
  ingestionGatewayIdIdx: index('devices_ingestion_gateway_id_idx').on(table.tenantId, table.ingestionGatewayId),
  // RFC-0058: BOX membership lookup (members of a box).
  boxIdIdx: index('devices_box_id_idx').on(table.tenantId, table.boxId),
  lastActivityTimeIdx: index('devices_last_activity_time_idx').on(table.tenantId, table.lastActivityTime),
  lastAlarmTimeIdx: index('devices_last_alarm_time_idx').on(table.tenantId, table.lastAlarmTime),

  // RFC-0008: Unique constraints
  // NOTE: tenantIdentifierUnique was removed — identifier is a Modbus register
  // name (e.g. 'CAG', 'TEMPERATURA') that repeats across devices on different
  // centrals/slaves within the same tenant. See fix-identifier-unique-constraint.sql
  // Channel-aware central/slave uniqueness (migration 0029 is authoritative:
  // it applies NULLS NOT DISTINCT so (central, slave, NULL, NULL) stays unique,
  // and a partial WHERE so NULL-central devices are unconstrained).
  tenantCentralSlaveChannelUnique: uniqueIndex('devices_tenant_central_slave_channel_unique')
    .on(table.tenantId, table.centralId, table.slaveId, table.channel, table.deviceChannelType)
    .where(sql`${table.centralId} IS NOT NULL AND ${table.slaveId} IS NOT NULL`),
  tenantCustomerNameUnique: uniqueIndex('devices_tenant_customer_name_unique').on(table.tenantId, table.customerId, table.name),

  // Check constraint for valid slave_id (1-999; Modbus RTU max 247, other protocols up to 999)
  validSlaveId: check('valid_slave_id', sql`${table.slaveId} IS NULL OR (${table.slaveId} >= 1 AND ${table.slaveId} <= 999)`),
  // migration 0029/0030. NULLS NOT DISTINCT on the unique index above is applied
  // by migration 0030 only (drizzle cannot express it in schema.ts).
  validChannel: check('devices_channel_range_check', sql`${table.channel} IS NULL OR (${table.channel} >= 0 AND ${table.channel} <= 999)`),

  // RFC-0032: index keyed on (tenant_id, wo_addr_low, wo_addr_high) — used by
  // POST /api/v1/wo/install when the field client passes addr_low/high
  // from the QR payload but no explicit device_id.
  woAddrIdx: index('idx_devices_wo_addr').on(table.tenantId, table.woAddrLow, table.woAddrHigh),
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
  scopeEntityIds: uuid('scope_entity_ids').array().notNull().default([]),
  scopeEntityOverrides: jsonb('scope_entity_overrides'),
  scopeInherited: boolean('scope_inherited').notNull().default(false),

  // Type-specific configuration (JSONB)
  alarmConfig: jsonb('alarm_config'),
  slaConfig: jsonb('sla_config'),
  escalationConfig: jsonb('escalation_config'),
  maintenanceConfig: jsonb('maintenance_config'),
  noConsumptionConfig: jsonb('no_consumption_config'),  // RFC-0055

  // Notification settings
  notificationChannels: jsonb('notification_channels').notNull().default([]),
  notifications: jsonb('notifications'),

  // Device profile filter (e.g. ['ELEVADOR', 'ESCADA_ROLANTE'])
  // When null/empty the rule applies to all profiles
  scopeProfiles: text('scope_profiles').array(),

  // Tags
  tags: jsonb('tags').notNull().default([]),

  // Status
  status: entityStatusEnum('status').notNull().default('ACTIVE'),
  enabled: boolean('enabled').notNull().default(true),

  // Metadata
  lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
  triggerCount: integer('trigger_count').notNull().default(0),

  // Internal rules are excluded from /alarm-rules/bundle/simple.
  // Consumed exclusively by internal services (e.g. alarm orchestrator).
  internalRule: boolean('internal_rule').notNull().default(false),

  // Internal support rules are included in all endpoints by default.
  // Pass includeInternalSupportRule=false to exclude them.
  isInternalSupportRule: boolean('is_internal_support_rule').notNull().default(false),

  // How many days back the alarm backend should look when evaluating this rule.
  lookbackDays: integer('lookback_days').notNull().default(0),

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
  validNoConsumptionConfig: check(   // RFC-0055
    'valid_no_consumption_config',
    sql`${table.type} != 'NO_CONSUMPTION' OR ${table.noConsumptionConfig} IS NOT NULL`
  ),
  // valid_scope_entity constraint removed — DEVICE scope with empty entityIds is valid
  // (intermediate state when user clears devices before adding new ones). See migration 0015.
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

  // Radio channel of the central (integer 1..255, preferably above 90).
  // Range enforced by centrals_frequency_range_check (migrations 0027/0028).
  frequency: integer('frequency').notNull().default(60),

  // Configuration and Stats
  config: jsonb('config').notNull().default({}),
  stats: jsonb('stats').notNull().default({}),
  location: jsonb('location'),

  // Tags
  tags: jsonb('tags').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),

  // Central-agent auth (field-swap backup/restore): shared HMAC secret the
  // central signs its poll-loop JWT (HS256) with. Provisioned in a later slice;
  // nullable so existing centrals keep working. See migration 0053.
  agentSecret: text('agent_secret'),

  // Zero-touch enrollment (Slice 1.5). An operator issues a one-time enroll
  // token; only its sha256 hash + expiry are stored. The central exchanges the
  // plaintext token for its agent_secret via POST /central-agent/enroll, which
  // clears the hash (single-use) and stamps enrolled_at. Re-issuing a fresh
  // token re-enables enrollment (field-swap). All nullable. See migration 0054.
  enrollTokenHash: text('enroll_token_hash'),
  enrollTokenExpiresAt: timestamp('enroll_token_expires_at', { withTimezone: true }),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }),

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

// Central backups (field-swap backup/restore). The CENTRAL runs pg_dump on its
// own embedded Postgres; gcdr only brokers the presigned S3 URL + tracks this
// metadata. See migration 0051_central_backups.sql.
export const centralBackupStatusEnum = pgEnum('central_backup_status', ['PENDING', 'AVAILABLE', 'EXPIRED', 'FAILED']);

export const centralBackups = pgTable('central_backups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  centralId: uuid('central_id').notNull().references(() => centrals.id),

  // S3 object (bytes never touch gcdr — central PUTs/GETs via presigned URL)
  storageKey: text('storage_key').notNull(),
  bucket: varchar('bucket', { length: 255 }).notNull(),
  contentType: varchar('content_type', { length: 127 }).notNull().default('application/octet-stream'),

  // Integrity (reported by the central on confirm)
  sha256: varchar('sha256', { length: 64 }),
  byteSize: bigint('byte_size', { mode: 'number' }),

  status: centralBackupStatusEnum('status').notNull().default('PENDING'),
  sourceLabel: varchar('source_label', { length: 32 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
}, (table) => ({
  storageKeyUnique: uniqueIndex('central_backups_storage_key_unique').on(table.storageKey),
  tenantCentralIdx: index('central_backups_tenant_central_idx').on(table.tenantId, table.centralId, table.createdAt),
  tenantStatusIdx: index('central_backups_tenant_status_idx').on(table.tenantId, table.status),
}));

// Central restore jobs (field-swap restore). The CENTRAL runs pg_restore on its
// own Postgres; gcdr tracks this job state machine, driven by the central's
// progress reports. See migration 0052_central_restore_jobs.sql.
export const centralRestoreJobStatusEnum = pgEnum('central_restore_job_status', ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED']);
export const centralRestoreJobPhaseEnum = pgEnum('central_restore_job_phase', ['QUEUED', 'DOWNLOAD', 'VERIFY', 'STOP_SERVICES', 'RESTORE_DB', 'START_SERVICES', 'DONE']);

export const centralRestoreJobs = pgTable('central_restore_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  centralId: uuid('central_id').notNull().references(() => centrals.id),
  sourceBackupId: uuid('source_backup_id').notNull().references(() => centralBackups.id),
  status: centralRestoreJobStatusEnum('status').notNull().default('QUEUED'),
  currentPhase: centralRestoreJobPhaseEnum('current_phase').notNull().default('QUEUED'),
  dryRun: boolean('dry_run').notNull().default(false),
  logEntries: jsonb('log_entries')
    .$type<{ ts: string; phase: string; level: string; message: string }[]>()
    .notNull()
    .default([]),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
}, (table) => ({
  tenantCentralIdx: index('central_restore_jobs_tenant_central_idx').on(table.tenantId, table.centralId, table.createdAt),
  tenantStatusIdx: index('central_restore_jobs_tenant_status_idx').on(table.tenantId, table.status),
  // CR-S5: stalled-job sweep filters status='RUNNING' AND updated_at < cutoff.
  statusUpdatedIdx: index('central_restore_jobs_status_updated_idx').on(table.status, table.updatedAt),
}));

// Central operational commands (reboot the box, restart the erlang/myio-core
// service). The CENTRAL runs the command via its myio-gcdr-agent poll loop;
// gcdr tracks this state machine, driven by the central's result report
// (exit_code + stdout + stderr). See migration 0053_central_commands.sql.
export const centralCommandTypeEnum = pgEnum('central_command_type', ['REBOOT', 'RESTART_ERLANG', 'RESTART_MYIOAPI']);
export const centralCommandStatusEnum = pgEnum('central_command_status', ['QUEUED', 'RUNNING', 'DONE', 'FAILED']);

export const centralCommands = pgTable('central_commands', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  centralId: uuid('central_id').notNull().references(() => centrals.id),
  type: centralCommandTypeEnum('type').notNull(),
  status: centralCommandStatusEnum('status').notNull().default('QUEUED'),
  exitCode: integer('exit_code'),
  stdout: text('stdout'),
  stderr: text('stderr'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
}, (table) => ({
  tenantCentralIdx: index('central_commands_tenant_central_idx').on(table.tenantId, table.centralId, table.createdAt),
  tenantStatusIdx: index('central_commands_tenant_status_idx').on(table.tenantId, table.status),
  statusUpdatedIdx: index('central_commands_status_updated_idx').on(table.status, table.updatedAt),
  // At most one in-flight command per central — race-proof backstop for the
  // app-level findActiveByCentral dedup (mirrors central_restore_jobs).
  oneActivePerCentral: uniqueIndex('central_commands_one_active_per_central')
    .on(table.centralId)
    .where(sql`${table.status} IN ('QUEUED', 'RUNNING')`),
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
// TEMPLATE TYPES
// =============================================================================

export const templateTypes = pgTable('template_types', {
  type:        varchar('type', { length: 50 }).primaryKey(),
  label:       varchar('label', { length: 100 }).notNull(),
  description: text('description'),
  icon:        varchar('icon', { length: 50 }),
  sortOrder:   integer('sort_order').notNull().default(0),
  active:      boolean('active').notNull().default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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

  // Template type binding (null = global/app UI theme)
  templateType: varchar('template_type', { length: 50 }),

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
  tenantTypeIdx: index('look_and_feels_tenant_type_idx').on(table.tenantId, table.templateType),
}));

// =============================================================================
// CUSTOMER API KEYS
// =============================================================================

export const customerApiKeys = pgTable('customer_api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),

  // Key data. key_plain makes the key recoverable after creation (operators
  // copy it into ThingsBoard SERVER_SCOPE attributes later) — retrieval only
  // via the audit-logged reveal endpoint; NULL for pre-0036 legacy keys.
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),
  keyPlain: text('key_plain'),

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

  // Hierarchy access control
  // SELF    → key can only access its own customer data (default)
  // SUBTREE → key can access customer + all descendants (?deep=1)
  // TENANT  → key has no customer restriction (full tenant access)
  hierarchyAccess: varchar('hierarchy_access', { length: 10 }).notNull().default('SELF'),

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
// AUDIT LOGS (RFC-0009)
// =============================================================================

export const auditLogs = pgTable('audit_logs', {
  // === Identification ===
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // === Event ===
  eventType: varchar('event_type', { length: 100 }).notNull(),
  eventCategory: eventCategoryEnum('event_category').notNull(),
  auditLevel: auditLevelEnum('audit_level').notNull().default('STANDARD'),
  description: varchar('description', { length: 500 }),
  action: varchar('action', { length: 20 }).notNull(),

  // === Entity (target of action) ===
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),
  customerId: uuid('customer_id'),

  // === Actor (who performed) ===
  userId: uuid('user_id'),
  userEmail: varchar('user_email', { length: 255 }),
  actorType: actorTypeEnum('actor_type').notNull().default('USER'),

  // === State before/after (sanitized) ===
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),

  // === Request context ===
  requestId: uuid('request_id'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: varchar('user_agent', { length: 500 }),
  httpMethod: varchar('http_method', { length: 10 }),
  httpPath: varchar('http_path', { length: 500 }),

  // === Result ===
  statusCode: integer('status_code'),
  errorMessage: varchar('error_message', { length: 2000 }),
  durationMs: integer('duration_ms'),

  // === Flexible metadata ===
  metadata: jsonb('metadata').notNull().default({}),
  externalLink: varchar('external_link', { length: 255 }),

  // === Timestamp ===
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantEntityIdx: index('audit_logs_tenant_entity_idx').on(table.tenantId, table.entityType, table.entityId),
  tenantUserIdx: index('audit_logs_tenant_user_idx').on(table.tenantId, table.userId),
  tenantCreatedIdx: index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
  tenantEventTypeIdx: index('audit_logs_tenant_event_type_idx').on(table.tenantId, table.eventType),
  tenantCustomerIdx: index('audit_logs_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantCategoryIdx: index('audit_logs_tenant_category_idx').on(table.tenantId, table.eventCategory),
  tenantActionIdx: index('audit_logs_tenant_action_idx').on(table.tenantId, table.action),
  tenantLevelIdx: index('audit_logs_tenant_level_idx').on(table.tenantId, table.auditLevel),
}));

// =============================================================================
// SIMULATOR (RFC-0010)
// =============================================================================

/**
 * Simulator Sessions - Tracks active simulation sessions
 */
export const simulatorSessions = pgTable('simulator_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  createdBy: uuid('created_by').notNull(),

  // Session info
  name: varchar('name', { length: 100 }).notNull(),
  status: simulatorSessionStatusEnum('status').notNull().default('PENDING'),

  // Configuration
  config: jsonb('config').notNull().default({}),

  // Quotas tracking
  scansCount: integer('scans_count').notNull().default(0),
  scansLimit: integer('scans_limit').notNull(),

  // Bundle state
  bundleVersion: varchar('bundle_version', { length: 50 }),
  bundleSignature: varchar('bundle_signature', { length: 128 }),
  bundleFetchedAt: timestamp('bundle_fetched_at', { withTimezone: true }),

  // Statistics
  alarmsTriggeredCount: integer('alarms_triggered_count').notNull().default(0),
  lastScanAt: timestamp('last_scan_at', { withTimezone: true }),

  // Lifecycle
  startedAt: timestamp('started_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantIdx: index('sim_sessions_tenant_idx').on(table.tenantId),
  statusIdx: index('sim_sessions_status_idx').on(table.status),
  tenantStatusIdx: index('sim_sessions_tenant_status_idx').on(table.tenantId, table.status),
  expiresIdx: index('sim_sessions_expires_idx').on(table.expiresAt),
}));

/**
 * Simulator Events - Audit trail of simulation events
 */
export const simulatorEvents = pgTable('simulator_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => simulatorSessions.id, { onDelete: 'cascade' }),

  // Event info
  eventType: varchar('event_type', { length: 50 }).notNull(),
  eventData: jsonb('event_data').notNull().default({}),

  // Timestamp
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionIdx: index('sim_events_session_idx').on(table.sessionId),
  createdIdx: index('sim_events_created_idx').on(table.createdAt),
  sessionTypeIdx: index('sim_events_session_type_idx').on(table.sessionId, table.eventType),
}));

// =============================================================================
// VERIFICATION TOKENS (RFC-0011)
// =============================================================================

/**
 * Verification Tokens - For email verification, password reset, account unlock
 */
export const verificationTokens = pgTable('verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Token data
  tokenType: verificationTokenTypeEnum('token_type').notNull(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),  // SHA256 hash of 6-digit code

  // Expiration
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  // Usage tracking
  usedAt: timestamp('used_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),

  // Metadata
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: varchar('user_agent', { length: 500 }),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('verification_tokens_user_idx').on(table.userId),
  typeIdx: index('verification_tokens_type_idx').on(table.tokenType),
  expiresIdx: index('verification_tokens_expires_idx').on(table.expiresAt),
  tenantUserTypeIdx: index('verification_tokens_tenant_user_type_idx').on(table.tenantId, table.userId, table.tokenType),
}));

// =============================================================================
// RFC-0013: USER ACCESS PROFILE BUNDLE
// =============================================================================

/**
 * Maintenance Groups - Groups of users for maintenance operations
 */
export const maintenanceGroups = pgTable('maintenance_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),

  // Identification
  key: varchar('key', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),

  // Scope
  customerId: uuid('customer_id').references(() => customers.id),

  // Members (denormalized for performance)
  memberCount: integer('member_count').notNull().default(0),

  // Status
  isActive: boolean('is_active').notNull().default(true),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  tenantKeyUnique: uniqueIndex('maintenance_groups_tenant_key_unique').on(table.tenantId, table.key),
  tenantCustomerIdx: index('maintenance_groups_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantActiveIdx: index('maintenance_groups_tenant_active_idx').on(table.tenantId, table.isActive),
}));

/**
 * User Maintenance Groups - Junction table for user-group assignments
 */
export const userMaintenanceGroups = pgTable('user_maintenance_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').notNull().references(() => maintenanceGroups.id, { onDelete: 'cascade' }),

  // Assignment metadata
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  assignedBy: uuid('assigned_by'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userGroupUnique: uniqueIndex('user_maintenance_groups_unique').on(table.userId, table.groupId),
  tenantUserIdx: index('user_maintenance_groups_tenant_user_idx').on(table.tenantId, table.userId),
  tenantGroupIdx: index('user_maintenance_groups_tenant_group_idx').on(table.tenantId, table.groupId),
}));

/**
 * Domain Permissions - Hierarchical permission definitions
 * Format: domain.equipment.location:action
 */
export const domainPermissions = pgTable('domain_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id'),  // NULL for system-wide permissions

  // Permission components
  domain: varchar('domain', { length: 50 }).notNull(),
  equipment: varchar('equipment', { length: 50 }).notNull(),
  location: varchar('location', { length: 50 }).notNull(),
  action: varchar('action', { length: 50 }).notNull(),

  // Metadata
  displayName: varchar('display_name', { length: 255 }),
  description: text('description'),
  riskLevel: riskLevelEnum('risk_level').notNull().default('low'),

  // Status
  isActive: boolean('is_active').notNull().default(true),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  permissionUnique: uniqueIndex('domain_permissions_unique').on(table.tenantId, table.domain, table.equipment, table.location, table.action),
  domainIdx: index('domain_permissions_domain_idx').on(table.domain),
  equipmentIdx: index('domain_permissions_equipment_idx').on(table.equipment),
  locationIdx: index('domain_permissions_location_idx').on(table.location),
  tenantActiveIdx: index('domain_permissions_tenant_active_idx').on(table.tenantId, table.isActive),
}));

/**
 * User Bundle Cache - Cached access bundles for performance
 */
export const userBundleCache = pgTable('user_bundle_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scope: varchar('scope', { length: 255 }).notNull(),

  // Cached bundle
  bundle: jsonb('bundle').notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),

  // Validity
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  // Invalidation tracking
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  invalidationReason: varchar('invalidation_reason', { length: 255 }),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userScopeUnique: uniqueIndex('user_bundle_cache_unique').on(table.tenantId, table.userId, table.scope),
  tenantUserIdx: index('user_bundle_cache_tenant_user_idx').on(table.tenantId, table.userId),
  expiresIdx: index('user_bundle_cache_expires_idx').on(table.expiresAt),
  invalidatedIdx: index('user_bundle_cache_invalidated_idx').on(table.invalidatedAt),
}));

// =============================================================================
// ALARM BUNDLE VERSIONS
// =============================================================================

// =============================================================================
// PUBLIC SINGLE APPS (RFC-0020)
// =============================================================================

export const publicSingleApps = pgTable('public_single_apps', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  fieldsSchema: jsonb('fields_schema').notNull().default({}),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
}, (table) => ({
  slugUnique: uniqueIndex('public_single_apps_slug_unique').on(table.slug),
  statusIdx: index('public_single_apps_status_idx').on(table.status),
}));

export const publicSingleAppResponses = pgTable('public_single_app_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: uuid('app_id').notNull().references(() => publicSingleApps.id),
  responseGroupId: uuid('response_group_id').notNull(),
  responseVersion: integer('response_version').notNull().default(1),
  isLatest: boolean('is_latest').notNull().default(true),
  formData: jsonb('form_data').notNull().default({}),
  submittedBy: jsonb('submitted_by').notNull().default({}),
  changesFromPrevious: jsonb('changes_from_previous'),
  changeNotes: text('change_notes'),
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (table) => ({
  groupVersionUnique: uniqueIndex('psar_group_version_unique').on(table.responseGroupId, table.responseVersion),
  appIdIdx: index('psar_app_id_idx').on(table.appId),
  groupIdx: index('psar_group_idx').on(table.responseGroupId),
  statusIdx: index('psar_status_idx').on(table.status),
  createdAtIdx: index('psar_created_at_idx').on(table.createdAt),
}));

export const alarmBundleVersions = pgTable('alarm_bundle_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull(),

  // Version info
  version: varchar('version', { length: 50 }).notNull(),
  previousVersion: varchar('previous_version', { length: 50 }),
  bundleType: varchar('bundle_type', { length: 10 }).notNull(),

  // Change tracking
  reason: varchar('reason', { length: 255 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),

  // Metadata
  rulesCount: integer('rules_count').notNull().default(0),
  devicesCount: integer('devices_count').notNull().default(0),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (table) => ({
  tenantCustomerIdx: index('abv_tenant_customer_idx').on(table.tenantId, table.customerId),
  versionIdx: index('abv_version_idx').on(table.version),
  createdAtIdx: index('abv_created_at_idx').on(table.createdAt),
}));

// =============================================================================
// RFC-0021: HTML Templates Engine
// =============================================================================

export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 255 }).notNull(),
  tenantId: uuid('tenant_id').notNull(),
  // NULL = tenant default; set = customer override (resolution: customer → parent chain → tenant)
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),

  name: varchar('name', { length: 500 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),     // EMAIL_ALARM | EMAIL_REPORT | EMAIL_WELCOME | ...
  status: varchar('status', { length: 50 }).notNull().default('DRAFT'),

  // TEXT — not varchar/jsonb — supports 20–50 KB HTML templates
  htmlContent: text('html_content').notNull(),

  description: varchar('description', { length: 1000 }),
  version: integer('version').notNull().default(1),

  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Partial unique indexes — PostgreSQL NULL != NULL requires separate indexes
  tenantTypeNullUnique:       uniqueIndex('tmpl_tenant_type_unique').on(table.tenantId, table.type).where(sql`${table.customerId} IS NULL`),
  customerTypeUnique:         uniqueIndex('tmpl_customer_type_unique').on(table.tenantId, table.customerId, table.type).where(sql`${table.customerId} IS NOT NULL`),
  slugTenantNullUnique:       uniqueIndex('tmpl_slug_tenant_null_unique').on(table.slug, table.tenantId).where(sql`${table.customerId} IS NULL`),
  slugTenantCustomerUnique:   uniqueIndex('tmpl_slug_tenant_customer_unique').on(table.slug, table.tenantId, table.customerId).where(sql`${table.customerId} IS NOT NULL`),
  tenantTypeStatusIdx:        index('tmpl_tenant_type_status_idx').on(table.tenantId, table.type, table.status),
}));

// =============================================================================
// RFC-0024: ALARM DISPATCH CONFIGURATION
// =============================================================================

export const alarmActionEnum = pgEnum('alarm_action', ['OPEN', 'ACK', 'ESCALATE', 'SNOOZE', 'CLOSE', 'STATE_HISTORY']);

export const customerChannels = pgTable('customer_channels', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  channel:    varchar('channel', { length: 50 }).notNull(),
  active:     boolean('active').notNull().default(true),
  config:     jsonb('config').notNull().default({}),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid('created_by'),
}, (table) => ({
  tenantCustomerChannelUnique: uniqueIndex('customer_channels_unique').on(table.tenantId, table.customerId, table.channel),
  tenantCustomerIdx:  index('customer_channels_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantActiveIdx:    index('customer_channels_tenant_active_idx').on(table.tenantId, table.active),
}));

export const groupDispatchConfigs = pgTable('group_dispatch_configs', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull(),
  groupId:            uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  channel:            varchar('channel', { length: 50 }).notNull(),
  action:             alarmActionEnum('action').notNull(),
  active:             boolean('active').notNull().default(true),
  escalationDelayMs:  integer('escalation_delay_ms').notNull().default(0),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantGroupChannelActionUnique: uniqueIndex('group_dispatch_configs_unique').on(table.tenantId, table.groupId, table.channel, table.action),
  tenantGroupIdx: index('group_dispatch_configs_tenant_group_idx').on(table.tenantId, table.groupId),
}));

export const groupChannels = pgTable('group_channels', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  groupId:   uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  channel:   varchar('channel', { length: 50 }).notNull(),
  active:    boolean('active').notNull().default(true),
  target:    text('target').notNull(),
  config:    jsonb('config').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantGroupChannelUnique: uniqueIndex('group_channels_unique').on(table.tenantId, table.groupId, table.channel),
  tenantGroupIdx: index('group_channels_tenant_group_idx').on(table.tenantId, table.groupId),
}));

// =============================================================================
// RFC-0023: DEVICE SYNC JOBS
// =============================================================================

export const deviceSyncJobStatusEnum = pgEnum('device_sync_job_status', ['QUEUED', 'RUNNING', 'DONE', 'PARTIAL', 'FAILED']);
export const deviceSyncJobPhaseEnum  = pgEnum('device_sync_job_phase',  ['QUEUED', 'CHECK', 'ACTION_PLAN', 'DETECT_RELOCATIONS', 'RELOCATE', 'APPLY_UPDATES', 'CONSOLIDATE_CREATES', 'DONE']);

export const deviceSyncJobs = pgTable('device_sync_jobs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  customerId:   uuid('customer_id').notNull(),
  status:       deviceSyncJobStatusEnum('status').notNull().default('QUEUED'),
  currentPhase: deviceSyncJobPhaseEnum('current_phase').notNull().default('QUEUED'),
  dryRun:       boolean('dry_run').notNull().default(false),

  // Input
  inputConfig:  jsonb('input_config').notNull().default({}),   // { defaultAssetId? }
  inputFiles:   jsonb('input_files').notNull().default([]),    // [{ name, content }]

  // Runtime state
  phasesSummary: jsonb('phases_summary').notNull().default({}),
  logEntries:    jsonb('log_entries').notNull().default([]),
  errorMessage:  text('error_message'),

  // Timestamps
  createdAt:   timestamp('created_at',   { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at',   { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  tenantCustomerIdx: index('device_sync_jobs_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantStatusIdx:   index('device_sync_jobs_tenant_status_idx').on(table.tenantId, table.status),
}));

// =============================================================================
// USER CONTACTS (RFC-0024 follow-up)
// =============================================================================

export const userContacts = pgTable('user_contacts', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel:   varchar('channel', { length: 50 }).notNull(),
  value:     varchar('value', { length: 500 }).notNull(),
  label:     varchar('label', { length: 100 }),
  verified:  boolean('verified').notNull().default(false),
  active:    boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantUserChannelValueUnique: uniqueIndex('user_contacts_unique').on(table.tenantId, table.userId, table.channel, table.value),
  tenantUserIdx:    index('user_contacts_tenant_user_idx').on(table.tenantId, table.userId),
  tenantChannelIdx: index('user_contacts_tenant_channel_idx').on(table.tenantId, table.channel),
}));

// =============================================================================
// RFC-0030: MYIO Wiki (Knowledge Base Module)
// =============================================================================

export const wikiNamespaces = pgTable('wiki_namespaces', {
  tenantId:        uuid('tenant_id').notNull(),
  name:            text('name').notNull(),
  description:     text('description'),
  reviewRequired:  boolean('review_required').notNull().default(false),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: uniqueIndex('wiki_namespaces_pk').on(table.tenantId, table.name),
  nameShape: check(
    'wiki_namespaces_name_shape',
    sql`${table.name} ~ '^[A-Za-z][A-Za-z0-9_-]{0,31}$'`
  ),
}));

export const wikiPages = pgTable('wiki_pages', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull(),
  namespace:         text('namespace').notNull(),
  slug:              text('slug').notNull(),
  title:             text('title').notNull(),
  status:            text('status').notNull().default('DRAFT'),
  // FK to wiki_page_revisions.id declared at the DB level (deferrable) —
  // not modeled with `.references()` here to avoid Drizzle forcing the
  // revisions table to exist before pages at compile time.
  currentRevisionId: uuid('current_revision_id'),
  tags:              text('tags').array().notNull().default(sql`'{}'::text[]`),
  visibility:        text('visibility').array().notNull().default(sql`ARRAY['TENANT_PRIVATE']::text[]`),
  frontmatter:       jsonb('frontmatter').notNull().default({}),
  createdBy:         uuid('created_by').notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:         timestamp('deleted_at', { withTimezone: true }),
  version:           integer('version').notNull().default(1),
}, (table) => ({
  tenantNsSlugUnique: uniqueIndex('wiki_pages_tenant_ns_slug_unique').on(table.tenantId, table.namespace, table.slug),
  tenantNsIdx:        index('idx_wiki_pages_tenant_ns').on(table.tenantId, table.namespace),
  tenantStatusIdx:    index('idx_wiki_pages_tenant_status').on(table.tenantId, table.status),
  statusCheck: check(
    'wiki_pages_status_check',
    sql`${table.status} IN ('DRAFT','REVIEW','PUBLISHED','ARCHIVED')`
  ),
  slugShape: check(
    'wiki_pages_slug_shape',
    sql`${table.slug} ~ '^[a-z0-9][a-z0-9/_-]{0,127}$'`
  ),
  visibilityNonEmpty: check(
    'wiki_pages_visibility_nonempty',
    sql`array_length(${table.visibility}, 1) >= 1`
  ),
  visibilityTagsValid: check(
    'wiki_pages_visibility_tags_valid',
    sql`${table.visibility} <@ ARRAY[
      'PUBLIC','MYIO_INTERNAL','PARTNERS',
      'HOLDING_CUSTOMERS','NON_HOLDING_CUSTOMERS','TENANT_PRIVATE'
    ]::text[]`
  ),
}));

export const wikiPageLinks = pgTable('wiki_page_links', {
  pageId:     uuid('page_id').notNull().references(() => wikiPages.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId:   text('entity_id').notNull(),
}, (table) => ({
  pk: uniqueIndex('wiki_page_links_pk').on(table.pageId, table.entityType, table.entityId),
  entityIdx: index('idx_wiki_page_links_entity').on(table.entityType, table.entityId),
  pageIdx:   index('idx_wiki_page_links_page').on(table.pageId),
  entityTypeCheck: check(
    'wiki_page_links_entity_type_check',
    sql`${table.entityType} IN ('device','customer','rule','asset','central','group','user','rfc')`
  ),
}));

// =============================================================================
// File Assets — generic file storage (RFC-0030 attachments, RFC-0031 PDFs,
// future avatars/logos/manuals). Polymorphic via (owner_type, owner_id).
// =============================================================================

export const fileAssets = pgTable('file_assets', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull(),
  customerId:       uuid('customer_id').references(() => customers.id),

  ownerType:        text('owner_type').notNull(),
  ownerId:          text('owner_id'),

  filename:         text('filename').notNull(),
  contentType:      text('content_type').notNull(),
  byteSize:         bigint('byte_size', { mode: 'number' }).notNull(),
  sha256:           text('sha256').notNull(),

  storageProvider:  text('storage_provider').notNull().default('S3'),
  storageBucket:    text('storage_bucket').notNull(),
  storageKey:       text('storage_key').notNull(),

  status:           text('status').notNull().default('ACTIVE'),
  scanStatus:       text('scan_status').notNull().default('PENDING'),

  uploadedBy:       uuid('uploaded_by').notNull(),
  uploadedAt:       timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:        timestamp('deleted_at', { withTimezone: true }),

  metadata:         jsonb('metadata').notNull().default({}),

  // Optional human-readable slug for stable public URLs.
  // Unique per tenant via partial index; CHECK enforces shape.
  publicSlug:       text('public_slug'),
}, (table) => ({
  tenantOwnerIdx:    index('idx_file_assets_tenant_owner').on(table.tenantId, table.ownerType, table.ownerId),
  tenantSha256Idx:   index('idx_file_assets_tenant_sha256').on(table.tenantId, table.sha256),

  ownerTypeCheck: check(
    'file_assets_owner_type_check',
    sql`${table.ownerType} IN ('wiki_page','wiki_pdf','free')`
  ),
  statusCheck: check(
    'file_assets_status_check',
    sql`${table.status} IN ('PENDING_UPLOAD','ACTIVE','QUARANTINED','DELETED')`
  ),
  scanStatusCheck: check(
    'file_assets_scan_status_check',
    sql`${table.scanStatus} IN ('PENDING','CLEAN','INFECTED','SKIPPED')`
  ),
  storageProviderCheck: check(
    'file_assets_storage_provider_check',
    sql`${table.storageProvider} IN ('S3','MINIO','LOCAL')`
  ),
  byteSizePositive: check(
    'file_assets_byte_size_positive',
    sql`${table.byteSize} >= 0`
  ),
  sha256Format: check(
    'file_assets_sha256_format',
    sql`${table.sha256} ~ '^[a-f0-9]{64}$'`
  ),
  ownerIdRequired: check(
    'file_assets_owner_id_when_typed',
    sql`${table.ownerType} = 'free' OR ${table.ownerId} IS NOT NULL`
  ),
  publicSlugShape: check(
    'file_assets_public_slug_shape',
    sql`${table.publicSlug} IS NULL OR ${table.publicSlug} ~ '^[a-z0-9][a-z0-9/_-]{0,127}$'`
  ),
}));

export const wikiPageRevisions = pgTable('wiki_page_revisions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  pageId:         uuid('page_id').notNull().references(() => wikiPages.id, { onDelete: 'cascade' }),
  revisionNumber: integer('revision_number').notNull(),
  title:          text('title').notNull(),
  body:           text('body').notNull(),
  bodyHtml:       text('body_html').notNull(),
  frontmatter:    jsonb('frontmatter').notNull().default({}),
  changeNote:     text('change_note'),
  authorId:       uuid('author_id').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // search_tsv is managed by a DB-level trigger — not written from app code.
  // Declared as text so it's queryable via `sql\`...\`` expressions.
  searchTsv:      text('search_tsv'),
}, (table) => ({
  pageRevUnique: uniqueIndex('wiki_page_revisions_page_rev_unique').on(table.pageId, table.revisionNumber),
  pageRevIdx:    index('idx_wiki_revisions_page_rev').on(table.pageId, table.revisionNumber),
  revNumPositive: check(
    'wiki_page_revisions_revnum_positive',
    sql`${table.revisionNumber} >= 1`
  ),
}));

// =============================================================================
// RFC-0037: Work Orders — Event Model (+ RFC-0036 generalized annotations).
//
// Replaces the rigid QR-Checker wo_* schema (migration 0026/0024) with an
// event-log model: a Work Order has N events, each with an event_type and a
// flexible jsonb payload. Observations reuse the (polymorphic) RFC-0036
// annotation subsystem. Reuses the existing `customers`, `users`, `assets`,
// `devices`, and `file_assets` tables.
//
// Migration: drizzle/migrations/0031_work_orders_event_model.sql
// =============================================================================

// Opt-in extension that marks a customer as "Work-Orders-enabled".
// Renamed from wo_customer_settings (migration 0031); shape unchanged.
export const woCustomerSettings = pgTable('work_orders_customer_settings', {
  customerId:         uuid('customer_id').primaryKey().references(() => customers.id, { onDelete: 'cascade' }),
  tenantId:           uuid('tenant_id').notNull(),
  viewerPasswordHash: text('viewer_password_hash'),
  defaultCentralId:   uuid('default_central_id'),
  woMetadata:        jsonb('wo_metadata').notNull().default({}),
  createdBy:          uuid('created_by').notNull(),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantIdx: index('idx_work_orders_cust_settings_tenant').on(table.tenantId),
}));

// -----------------------------------------------------------------------------
// 1) Work Order (status is a service-maintained projection of lifecycle events)
// -----------------------------------------------------------------------------
export const workOrders = pgTable('work_orders', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  customerId:   uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  rootAssetId:  uuid('root_asset_id').references(() => assets.id, { onDelete: 'set null' }),
  type:         text('type').notNull(),
  status:       text('status').notNull().default('PLANEJADA'),
  code:         text('code').notNull(),
  assignedTo:   uuid('assigned_to').references(() => users.id),
  scheduledAt:  timestamp('scheduled_at', { withTimezone: true }),
  // RFC-0044: the CHAMADO (type=CHAMADO) work order this OS hangs on (mutable).
  ticketId:     uuid('ticket_id'),
  // RFC-0051: structural parent edge (Grupo de OS / sub-OS). Orthogonal to
  // ticketId — an OS can hang on a chamado AND belong to a grupo.
  parentId:     uuid('parent_id'),
  createdBy:    uuid('created_by').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:    timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  tenantCustomerIdx: index('work_orders_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantStatusIdx:   index('work_orders_tenant_status_idx').on(table.tenantId, table.status),
  rootAssetIdx:      index('work_orders_root_asset_idx').on(table.rootAssetId),
  ticketIdx:         index('work_orders_ticket_idx').on(table.tenantId, table.ticketId).where(sql`${table.ticketId} IS NOT NULL`),
  parentIdx:         index('work_orders_parent_idx').on(table.tenantId, table.parentId).where(sql`${table.parentId} IS NOT NULL`),
  tenantCodeUnique:  uniqueIndex('work_orders_tenant_code_unique').on(table.tenantId, table.code).where(sql`${table.deletedAt} IS NULL`),
  typeCheck: check(
    'work_orders_type_check',
    sql`${table.type} IN ('INSTALACAO','MANUTENCAO','VISITA_TECNICA','CHAMADO','GRUPO')`
  ),
}));

// -----------------------------------------------------------------------------
// 2) Device scope (junction)
// -----------------------------------------------------------------------------
export const workOrdersDevices = pgTable('work_orders_devices', {
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  deviceId:    uuid('device_id').notNull().references(() => devices.id, { onDelete: 'restrict' }),
  addedBy:     uuid('added_by').notNull(),
  addedAt:     timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.workOrderId, table.deviceId] }),
  deviceIdx: index('work_orders_devices_device_idx').on(table.deviceId),
}));

// -----------------------------------------------------------------------------
// 3) Event types catalog (extensible — add a type without a migration)
// -----------------------------------------------------------------------------
export const workOrdersEventTypes = pgTable('work_orders_event_types', {
  code:       text('code').primaryKey(),
  category:   text('category').notNull(),
  label:      text('label').notNull(),
  isTerminal: boolean('is_terminal').notNull().default(false),
  sortOrder:  integer('sort_order').notNull().default(0),
  active:     boolean('active').notNull().default(true),
});

// RFC-0041 — per-tenant data-driven WO flow. The Rules Engine reads these rows;
// when a tenant has none it falls back to the built-in default flow.
export const workOrdersLifecycleRules = pgTable('work_orders_lifecycle_rules', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull(),
  woType:          text('wo_type'),                                  // NULL = all types
  eventType:       text('event_type').notNull().references(() => workOrdersEventTypes.code),
  predecessors:    text('predecessors').array().notNull().default(sql`'{}'::text[]`),
  predecessorRule: text('predecessor_rule').notNull().default('NONE'),
  activates:       text('activates').array().notNull().default(sql`'{}'::text[]`),
  projectsStatus:  text('projects_status'),                         // NULL = marker
  isEntry:         boolean('is_entry').notNull().default(false),
  isTerminal:      boolean('is_terminal').notNull().default(false), // closes the WO
  sortOrder:       integer('sort_order').notNull().default(0),
  active:          boolean('active').notNull().default(true),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantIdx: index('work_orders_lifecycle_rules_tenant_idx').on(table.tenantId),
}));

// -----------------------------------------------------------------------------
// 4) Events (append-only "what happened, in order")
// -----------------------------------------------------------------------------
export const workOrdersEvents = pgTable('work_orders_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  eventType:   text('event_type').notNull().references(() => workOrdersEventTypes.code),
  actorType:   text('actor_type').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actor:       jsonb('actor'),
  assetId:     uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
  deviceId:    uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  payload:     jsonb('payload').notNull().default({}),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  woChronoIdx: index('work_orders_events_wo_chrono_idx').on(table.workOrderId, table.createdAt),
  typeIdx:     index('work_orders_events_type_idx').on(table.tenantId, table.eventType),
  deviceIdx:   index('work_orders_events_device_idx').on(table.deviceId).where(sql`device_id IS NOT NULL`),
  actorTypeCheck: check(
    'work_orders_events_actor_type_check',
    sql`${table.actorType} IN ('USER','SYSTEM','API_KEY')`
  ),
}));

// -----------------------------------------------------------------------------
// 5) Files / evidence (→ file_assets; optionally tied to the event that added it)
// -----------------------------------------------------------------------------
export const workOrderFiles = pgTable('work_order_files', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull(),
  workOrderId:      uuid('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  workOrderEventId: uuid('work_order_event_id').references(() => workOrdersEvents.id, { onDelete: 'set null' }),
  fileAssetId:      uuid('file_asset_id').notNull().references(() => fileAssets.id),
  imageOrder:       integer('image_order').notNull().default(0),
  caption:          text('caption'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  woFileUnique: uniqueIndex('work_order_files_wo_file_unique').on(table.workOrderId, table.fileAssetId),
  woIdx:        index('work_order_files_wo_idx').on(table.workOrderId, table.imageOrder),
  eventIdx:     index('work_order_files_event_idx').on(table.workOrderEventId),
}));

// =============================================================================
// RFC-0036 (generalized): Annotation subsystem. Polymorphic target via
// entity_type ('device' | 'work_order' | 'work_order_event') + entity_id
// (no DB FK across polymorphic targets; integrity enforced in the service).
// Reuses customers / users / devices / file_assets.
// =============================================================================

// -----------------------------------------------------------------------------
// annotations (aggregate root)
// -----------------------------------------------------------------------------
export const annotations = pgTable('annotations', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  customerId:     uuid('customer_id').notNull().references(() => customers.id),
  entityType:     text('entity_type').notNull(),
  entityId:       uuid('entity_id').notNull(),
  schemaVersion:  text('schema_version').notNull().default('1.0.0'),
  text:           text('text').notNull(),
  type:           text('type').notNull().default('observation'),
  importance:     smallint('importance').notNull().default(3),
  status:         text('status').notNull().default('created'),
  finalized:        boolean('finalized').notNull().default(false),
  finalizedReason:  text('finalized_reason'),
  dueDate:          timestamp('due_date', { withTimezone: true }),
  acknowledged:     boolean('acknowledged').notNull().default(false),
  acknowledgedBy:   jsonb('acknowledged_by'),
  acknowledgedAt:   timestamp('acknowledged_at', { withTimezone: true }),
  createdBy:      jsonb('created_by').notNull(),
  updatedBy:      jsonb('updated_by'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:      timestamp('deleted_at', { withTimezone: true }),
  version:        integer('version').notNull().default(1),
  legacyId:       uuid('legacy_id'),
}, (table) => ({
  entityIdx:         index('annotations_entity_idx').on(table.tenantId, table.entityType, table.entityId),
  tenantCustomerIdx: index('annotations_tenant_customer_idx').on(table.tenantId, table.customerId),
  tenantStatusIdx:   index('annotations_tenant_status_idx').on(table.tenantId, table.status).where(sql`deleted_at IS NULL`),
  tenantTypeIdx:     index('annotations_tenant_type_idx').on(table.tenantId, table.type).where(sql`deleted_at IS NULL`),
  tenantLegacyIdUnique: uniqueIndex('annotations_tenant_legacy_id_unique').on(table.tenantId, table.legacyId).where(sql`legacy_id IS NOT NULL`),
  entityTypeCheck: check(
    'annotations_entity_type_check',
    sql`${table.entityType} IN ('device','work_order','work_order_event')`
  ),
  typeCheck: check(
    'annotations_type_check',
    sql`${table.type} IN ('observation','pending','maintenance','activity')`
  ),
  statusCheck: check(
    'annotations_status_check',
    sql`${table.status} IN ('created','modified','archived')`
  ),
  importanceCheck: check(
    'annotations_importance_check',
    sql`${table.importance} BETWEEN 1 AND 5`
  ),
  finalizedReasonCheck: check(
    'annotations_finalized_reason_check',
    sql`${table.finalizedReason} IS NULL OR ${table.finalizedReason} IN ('approved','rejected','archived')`
  ),
  textLenCheck: check(
    'annotations_text_len_check',
    sql`char_length(${table.text}) <= 255`
  ),
}));

// -----------------------------------------------------------------------------
// annotation_responses (comments + finalizing decisions)
// -----------------------------------------------------------------------------
export const annotationResponses = pgTable('annotation_responses', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  annotationId: uuid('annotation_id').notNull().references(() => annotations.id, { onDelete: 'cascade' }),
  type:         text('type').notNull(),
  text:         text('text'),
  createdBy:    jsonb('created_by').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  legacyId:     uuid('legacy_id'),
}, (table) => ({
  annotationIdx: index('annotation_responses_annotation_idx').on(table.annotationId, table.createdAt),
  tenantLegacyIdUnique: uniqueIndex('annotation_responses_tenant_legacy_id_unique').on(table.tenantId, table.legacyId).where(sql`legacy_id IS NOT NULL`),
  typeCheck: check(
    'annotation_responses_type_check',
    sql`${table.type} IN ('approved','rejected','comment','archived')`
  ),
  textRequiredCheck: check(
    'annotation_responses_text_required_check',
    sql`${table.type} = 'approved' OR (${table.text} IS NOT NULL AND char_length(${table.text}) > 0)`
  ),
  textLenCheck: check(
    'annotation_responses_text_len_check',
    sql`${table.text} IS NULL OR char_length(${table.text}) <= 255`
  ),
}));

// -----------------------------------------------------------------------------
// annotation_events (append-only history)
// -----------------------------------------------------------------------------
export const annotationEvents = pgTable('annotation_events', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull(),
  annotationId:    uuid('annotation_id').notNull().references(() => annotations.id, { onDelete: 'cascade' }),
  responseId:      uuid('response_id').references(() => annotationResponses.id, { onDelete: 'set null' }),
  action:          text('action').notNull(),
  previousVersion: integer('previous_version'),
  changes:         jsonb('changes'),
  actor:           jsonb('actor').notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  annotationIdx: index('annotation_events_annotation_idx').on(table.annotationId, table.createdAt),
  actionCheck: check(
    'annotation_events_action_check',
    sql`${table.action} IN ('created','modified','archived','approved','rejected','commented','acknowledged')`
  ),
}));

// -----------------------------------------------------------------------------
// annotation_mentions (mention a user OR a device)
// -----------------------------------------------------------------------------
export const annotationMentions = pgTable('annotation_mentions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull(),
  annotationId:      uuid('annotation_id').notNull().references(() => annotations.id, { onDelete: 'cascade' }),
  responseId:        uuid('response_id').references(() => annotationResponses.id, { onDelete: 'cascade' }),
  mentionType:       text('mention_type').notNull(),
  mentionedUserId:   uuid('mentioned_user_id').references(() => users.id),
  mentionedDeviceId: uuid('mentioned_device_id').references(() => devices.id),
  actor:             jsonb('actor').notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  annotationIdx: index('annotation_mentions_annotation_idx').on(table.annotationId),
  userIdx:       index('annotation_mentions_user_idx').on(table.tenantId, table.mentionedUserId).where(sql`mentioned_user_id IS NOT NULL`),
  deviceIdx:     index('annotation_mentions_device_idx').on(table.tenantId, table.mentionedDeviceId).where(sql`mentioned_device_id IS NOT NULL`),
  typeCheck: check(
    'annotation_mentions_type_check',
    sql`${table.mentionType} IN ('user','device')`
  ),
  targetCheck: check(
    'annotation_mentions_target_check',
    sql`(${table.mentionType} = 'user' AND ${table.mentionedUserId} IS NOT NULL AND ${table.mentionedDeviceId} IS NULL) OR (${table.mentionType} = 'device' AND ${table.mentionedDeviceId} IS NOT NULL AND ${table.mentionedUserId} IS NULL)`
  ),
}));

// -----------------------------------------------------------------------------
// annotation_attachments (reuse file_assets via a thin link table)
// -----------------------------------------------------------------------------
export const annotationAttachments = pgTable('annotation_attachments', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  annotationId: uuid('annotation_id').notNull().references(() => annotations.id, { onDelete: 'cascade' }),
  responseId:   uuid('response_id').references(() => annotationResponses.id, { onDelete: 'cascade' }),
  fileAssetId:  uuid('file_asset_id').notNull().references(() => fileAssets.id),
  createdBy:    jsonb('created_by').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  annotationIdx: index('annotation_attachments_annotation_idx').on(table.annotationId),
  responseIdx:   index('annotation_attachments_response_idx').on(table.responseId).where(sql`response_id IS NOT NULL`),
  fileIdx:       index('annotation_attachments_file_idx').on(table.fileAssetId),
}));

// -----------------------------------------------------------------------------
// assistant_conversations (RFC-0043) — persisted GCDR Copiloto chat history.
// Private to the owner unless `shared` = true (then readable by the tenant).
// -----------------------------------------------------------------------------
export const assistantConversations = pgTable('assistant_conversations', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  userId:    uuid('user_id').notNull(),
  title:     varchar('title', { length: 200 }).notNull().default('Conversa'),
  messages:  jsonb('messages').notNull().default(sql`'[]'::jsonb`),
  shared:    boolean('shared').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIdx:  index('assistant_conversations_owner_idx').on(table.tenantId, table.userId, table.updatedAt),
  sharedIdx: index('assistant_conversations_shared_idx').on(table.tenantId, table.shared, table.updatedAt),
}));

// -----------------------------------------------------------------------------
// work_orders_ticket_meta (RFC-0044) — ticket-specific 1:1 extension of a
// work_order with type = CHAMADO. Keeps the main work_orders table lean.
// -----------------------------------------------------------------------------
export const workOrdersTicketMeta = pgTable('work_orders_ticket_meta', {
  workOrderId:     uuid('work_order_id').primaryKey().references(() => workOrders.id, { onDelete: 'cascade' }),
  tenantId:        uuid('tenant_id').notNull(),
  subject:         varchar('subject', { length: 255 }).notNull(),
  priority:        text('priority').notNull().default('MEDIA'),
  reason:          text('reason'),
  source:          text('source').notNull().default('PAINEL'),
  requesterEmail:  varchar('requester_email', { length: 255 }).notNull(),
  requesterUserId: uuid('requester_user_id').references(() => users.id),
  requesterDomain: text('requester_domain'),
  externalId:      text('external_id'),
  firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
  resolvedAt:      timestamp('resolved_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  requesterIdx: index('work_orders_ticket_meta_requester_idx').on(table.tenantId, table.requesterEmail),
  domainIdx:    index('work_orders_ticket_meta_domain_idx').on(table.tenantId, table.requesterDomain),
  externalIdx:  index('work_orders_ticket_meta_external_idx').on(table.tenantId, table.externalId).where(sql`${table.externalId} IS NOT NULL`),
  priorityCheck: check('work_orders_ticket_meta_priority_check', sql`${table.priority} IN ('BAIXA','MEDIA','ALTA','URGENTE')`),
  sourceCheck:   check('work_orders_ticket_meta_source_check', sql`${table.source} IN ('PAINEL','EMAIL','FRESHDESK','API')`),
}));

// -----------------------------------------------------------------------------
// work_orders_watchers (RFC-0044) — CC list for a chamado.
// -----------------------------------------------------------------------------
export const workOrdersWatchers = pgTable('work_orders_watchers', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  email:       varchar('email', { length: 255 }).notNull(),
  userId:      uuid('user_id').references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  woEmailUnique: uniqueIndex('work_orders_watchers_unique').on(table.workOrderId, table.email),
}));

// =============================================================================
// CONSUMPTION GOALS (RFC-0046)
// =============================================================================
// Per-customer targets for ENERGY | WATER | TEMPERATURE, scoped by domain and
// year, persisted at a single canonical grain — the hour. The parent row holds
// the optimistic `version`; hours are derived-on-write / aggregated-on-read.

// 1) Parent — one per (tenant, customer, domain, year); carries the version.
export const consumptionGoals = pgTable('consumption_goals', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  domain:     text('domain').notNull(),                 // ENERGY | WATER | TEMPERATURE
  year:       smallint('year').notNull(),
  unit:       text('unit').notNull(),                    // kWh | m3 | C (from domain config)
  version:    integer('version').notNull().default(1),
  // RFC-0046 Addendum A (DEC-8, migration 0061): stated on the header, never
  // inferred from row shape. CUSTOMER = device_id NULL rows (legacy);
  // DEVICE = every row carries a device_id.
  granularity: text('granularity').notNull().default('CUSTOMER'),
  // RFC-0054 Phase 3 (DEC-4, migration 0063): the goal's measure — QUANTITY
  // (kWh/m3, default/legacy) or CURRENCY (a native R$ budget). Part of the
  // goal identity (see the uq below) so both can coexist for one (domain, year).
  measure: text('measure').notNull().default('QUANTITY'),
  // RFC-0052 — read-time margin overlay ("Margem da meta"); buckets stay raw.
  goalMarginPct:       numeric('goal_margin_pct', { precision: 6, scale: 2 }),
  goalMarginUpdatedBy: uuid('goal_margin_updated_by'),
  goalMarginUpdatedAt: timestamp('goal_margin_updated_at', { withTimezone: true }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid('created_by'),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:  uuid('updated_by'),
}, (table) => ({
  uq:          uniqueIndex('consumption_goals_uq').on(table.tenantId, table.customerId, table.domain, table.year, table.measure),
  customerIdx: index('consumption_goals_customer_idx').on(table.tenantId, table.customerId),
  domainCheck: check(
    'consumption_goals_domain_check',
    sql`${table.domain} IN ('ENERGY','WATER','TEMPERATURE')`
  ),
  measureCheck: check(
    'consumption_goals_measure_check',
    sql`${table.measure} IN ('QUANTITY','CURRENCY')`
  ),
  marginRangeCheck: check(
    'consumption_goals_margin_range_check',
    sql`${table.goalMarginPct} IS NULL OR (${table.goalMarginPct} >= -100 AND ${table.goalMarginPct} <= 100)`
  ),
  granularityCheck: check(
    'consumption_goals_granularity_check',
    sql`${table.granularity} IN ('CUSTOMER','DEVICE')`
  ),
}));

// 2) Canonical hourly grain. One row per (goal, month, day, hour).
export const consumptionGoalHours = pgTable('consumption_goal_hours', {
  goalId:      uuid('goal_id').notNull().references(() => consumptionGoals.id, { onDelete: 'cascade' }),
  month:       smallint('month').notNull(),              // 1..12
  day:         smallint('day').notNull(),                // 1..31 (valid for the month/year)
  hour:        smallint('hour').notNull(),               // 0..23
  value:       numeric('value').notNull(),
  sourceLevel: text('source_level').notNull(),           // YEAR | MONTH | DAY | HOUR — level the user set
  derived:     boolean('derived').notNull(),             // true = system-distributed
  // RFC-0046 Addendum A (DEC-7/8, migration 0061): optional device coordinate.
  // NULL = CUSTOMER-granular row (legacy shape). RESTRICT on purpose — goal
  // hours are operator-authored targets.
  deviceId:    uuid('device_id').references(() => devices.id, { onDelete: 'restrict' }),
  // Stored generated column (COALESCE(device_id, zero-uuid)) so the upsert's
  // conflict target stays on plain columns (Drizzle can't hit expression
  // indexes). NEVER write this column.
  deviceKey:   uuid('device_key').generatedAlwaysAs(
    sql`COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
  ),
  // EXPLICIT = operator stated this device's value; RESIDUAL = allocated from
  // the group total (DEC-8 residual rule).
  deviceAllocation: text('device_allocation').notNull().default('EXPLICIT'),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:   uuid('updated_by'),
}, (table) => ({
  uq: uniqueIndex('consumption_goal_hours_device_uq').on(
    table.goalId, table.deviceKey, table.month, table.day, table.hour,
  ),
  monthRange:  check('consumption_goal_hours_month_check', sql`${table.month} BETWEEN 1 AND 12`),
  dayRange:    check('consumption_goal_hours_day_check',   sql`${table.day} BETWEEN 1 AND 31`),
  hourRange:   check('consumption_goal_hours_hour_check',  sql`${table.hour} BETWEEN 0 AND 23`),
  sourceLevelCheck: check(
    'consumption_goal_hours_source_level_check',
    sql`${table.sourceLevel} IN ('YEAR','MONTH','DAY','HOUR')`
  ),
  allocationCheck: check(
    'consumption_goal_hours_allocation_check',
    sql`${table.deviceAllocation} IN ('EXPLICIT','RESIDUAL')`
  ),
}));

// 3) Fixed aggregation config per (tenant, domain). Seeded; operator-immutable.
export const consumptionGoalDomains = pgTable('consumption_goal_domains', {
  tenantId:          uuid('tenant_id').notNull(),
  domain:            text('domain').notNull(),           // ENERGY | WATER | TEMPERATURE
  aggregationMethod: text('aggregation_method').notNull(), // SUM | AVERAGE
  unit:              text('unit').notNull(),             // kWh | m3 | C
}, (table) => ({
  pk: primaryKey({ columns: [table.tenantId, table.domain] }),
  aggregationMethodCheck: check(
    'consumption_goal_domains_agg_method_check',
    sql`${table.aggregationMethod} IN ('SUM','AVERAGE')`
  ),
  domainCheck: check(
    'consumption_goal_domains_domain_check',
    sql`${table.domain} IN ('ENERGY','WATER','TEMPERATURE')`
  ),
}));

// 4) Append-only history. Records the level the user acted on (DEC-4).
// goal_id has NO FK on purpose; the stable key columns below (migration 0060)
// keep the audit trail reachable after a whole-year delete removes the parent.
export const consumptionGoalHistory = pgTable('consumption_goal_history', {
  id:            uuid('id').primaryKey().defaultRandom(),
  goalId:        uuid('goal_id').notNull(),
  tenantId:      uuid('tenant_id'),                      // stable goal key (nullable: pre-0060 orphans)
  customerId:    uuid('customer_id'),
  domain:        text('domain'),
  year:          integer('year'),
  measure:       text('measure'),                        // RFC-0054 P3 (0063): QUANTITY | CURRENCY — separate audit streams
  deviceId:      uuid('device_id'),                      // Addendum A: device the operation targeted (nullable)
  actor:         uuid('actor'),                          // who changed it
  source:        text('source').notNull().default('EDIT'), // IMPORT | REPLACE | MERGE | DELETE | EDIT — the operation
  actionLevel:   text('action_level').notNull(),         // YEAR | MONTH | DAY | HOUR — what the user touched
  bucketRef:     text('bucket_ref').notNull(),           // "2026" | "2026-03" | "2026-03-15" | "2026-03-15T08"
  oldValue:      numeric('old_value'),                   // at the input level (NULL on create)
  newValue:      numeric('new_value'),                   // at the input level (NULL on delete / multi-bucket op)
  bucketCount:   integer('bucket_count').notNull().default(1), // operator buckets this operation carried
  details:       jsonb('details').notNull().default([]), // compact [{ ref, value }] sample for the timeline
  distributed:   boolean('distributed').notNull(),       // true = system spread to hours
  hoursAffected: integer('hours_affected').notNull(),    // count of hour rows written by this change
  version:       integer('version').notNull(),           // the version this change produced
  changedAt:     timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  goalChronoIdx: index('consumption_goal_history_idx').on(table.goalId, table.changedAt.desc()),
  goalKeyIdx: index('consumption_goal_history_key_idx').on(
    table.tenantId, table.customerId, table.domain, table.year, table.measure, table.changedAt.desc(),
  ),
  actionLevelCheck: check(
    'consumption_goal_history_action_level_check',
    sql`${table.actionLevel} IN ('YEAR','MONTH','DAY','HOUR')`
  ),
  sourceCheck: check(
    'consumption_goal_history_source_check',
    sql`${table.source} IN ('IMPORT','REPLACE','MERGE','DELETE','EDIT','MARGIN','REBALANCE')`
  ),
}));

// ===========================================================================
// RFC-0054 (APPROVED rev. 3) — Phase 1: hourly customer tariffs (migration 0062)
//
// A tariff is (customer, domain, category, year) distributed to an HOURLY
// canonical grain — a sibling of a goal. `category` (COMMON_AREA | SPECIFIC)
// is an explicit device attribute (DEC-2). Hourly grain + a plain UNIQUE on
// (tariff_id, month, day, hour) makes overlap impossible by construction —
// NO daterange/EXCLUDE/btree_gist. Calendar is nominal civil hours (DEC-8).
// Phase 1 is additive and never touches `consumption_goals` (DEC-12).
// ===========================================================================

// 1) Tariff header — one per (tenant, customer, domain, category, year).
export const customerTariffs = pgTable('customer_tariffs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  customerId:  uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  domain:      text('domain').notNull(),                 // ENERGY | WATER (priced SUM domains)
  category:    text('category').notNull(),               // COMMON_AREA | SPECIFIC
  year:        smallint('year').notNull(),
  unit:        text('unit').notNull(),                   // kWh | m3 (from domain)
  currency:    text('currency').notNull().default('BRL'),
  tariffModel: text('tariff_model').notNull().default('FLAT'), // v1 = FLAT; evolution axis
  timezone:    text('timezone').notNull().default('America/Sao_Paulo'), // nominal civil-hour calendar (DEC-8)
  version:     integer('version').notNull().default(1),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid('created_by'),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:   uuid('updated_by'),
}, (table) => ({
  uq:          uniqueIndex('customer_tariffs_uq').on(table.tenantId, table.customerId, table.domain, table.category, table.year),
  customerIdx: index('customer_tariffs_customer_idx').on(table.tenantId, table.customerId),
  domainCheck:   check('customer_tariffs_domain_check',   sql`${table.domain} IN ('ENERGY','WATER')`),
  categoryCheck: check('customer_tariffs_category_check', sql`${table.category} IN ('COMMON_AREA','SPECIFIC')`),
  unitCheck:     check('customer_tariffs_unit_check',     sql`${table.unit} IN ('kWh','m3')`),
  currencyCheck: check('customer_tariffs_currency_check', sql`${table.currency} = 'BRL'`),
  modelCheck:    check('customer_tariffs_model_check',    sql`${table.tariffModel} IN ('FLAT')`),
  // unit is derived from domain (RFC-0054): ENERGY→kWh, WATER→m3.
  domainUnitCheck: check(
    'customer_tariffs_domain_unit_check',
    sql`(${table.domain} = 'ENERGY' AND ${table.unit} = 'kWh') OR (${table.domain} = 'WATER' AND ${table.unit} = 'm3')`
  ),
}));

// 2) Canonical hourly grain. One row per (tariff, month, day, hour). The plain
// UNIQUE is the whole no-overlap story — a band is a contiguous set of rows.
export const customerTariffHours = pgTable('customer_tariff_hours', {
  tariffId:    uuid('tariff_id').notNull().references(() => customerTariffs.id, { onDelete: 'cascade' }),
  month:       smallint('month').notNull(),              // 1..12
  day:         smallint('day').notNull(),                // 1..31 (valid for month/year; 29 Feb in leap years)
  hour:        smallint('hour').notNull(),               // 0..23 (nominal civil hour)
  price:       numeric('price', { precision: 14, scale: 6 }).notNull(), // R$ per unit
  sourceLevel: text('source_level').notNull(),           // YEAR | MONTH | DAY | HOUR
  derived:     boolean('derived').notNull(),             // true = system-distributed
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:   uuid('updated_by'),
}, (table) => ({
  uq:          uniqueIndex('customer_tariff_hours_uq').on(table.tariffId, table.month, table.day, table.hour),
  monthRange:  check('customer_tariff_hours_month_check', sql`${table.month} BETWEEN 1 AND 12`),
  dayRange:    check('customer_tariff_hours_day_check',   sql`${table.day} BETWEEN 1 AND 31`),
  hourRange:   check('customer_tariff_hours_hour_check',  sql`${table.hour} BETWEEN 0 AND 23`),
  priceCheck:  check('customer_tariff_hours_price_check', sql`${table.price} > 0`),
  sourceLevelCheck: check(
    'customer_tariff_hours_source_level_check',
    sql`${table.sourceLevel} IN ('YEAR','MONTH','DAY','HOUR')`
  ),
}));

// 3) Append-only audit; stable key survives a header delete (mirrors goal history).
// Stable-key columns are NOT NULL by design (greenfield; the trail must stay
// reachable by identity after a header delete).
export const customerTariffHistory = pgTable('customer_tariff_history', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tariffId:      uuid('tariff_id').notNull(),             // no FK: audit outlives the header
  tenantId:      uuid('tenant_id').notNull(),
  customerId:    uuid('customer_id').notNull(),
  domain:        text('domain').notNull(),
  category:      text('category').notNull(),
  year:          integer('year').notNull(),
  actor:         uuid('actor'),
  source:        text('source').notNull().default('EDIT'),   // IMPORT | REPLACE | MERGE | DELETE | EDIT
  actionLevel:   text('action_level').notNull(),             // YEAR | MONTH | DAY | HOUR
  bucketRef:     text('bucket_ref').notNull(),               // "2026" | "2026-07" | "2026-07-01" | "2026-07-01T15"
  oldPrice:      numeric('old_price', { precision: 14, scale: 6 }),
  newPrice:      numeric('new_price', { precision: 14, scale: 6 }),
  bucketCount:   integer('bucket_count').notNull().default(1),
  hoursAffected: integer('hours_affected').notNull(),
  version:       integer('version').notNull(),
  changedAt:     timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  keyIdx: index('customer_tariff_history_key_idx').on(
    table.tenantId, table.customerId, table.domain, table.category, table.year, table.changedAt.desc(),
  ),
  sourceCheck: check(
    'customer_tariff_history_source_check',
    sql`${table.source} IN ('IMPORT','REPLACE','MERGE','DELETE','EDIT')`
  ),
  actionLevelCheck: check(
    'customer_tariff_history_action_level_check',
    sql`${table.actionLevel} IN ('YEAR','MONTH','DAY','HOUR')`
  ),
}));

// ===========================================================================
// RFC-0061 — Inventory & Warehouse Management ("Menu de Estoque"), migration
// 0067. Tables prefixed `inv_`. Conventions (RFC §Data model): id uuid pk
// default gen_random_uuid(); tenant_id not null; created_at/updated_at tz;
// created_by uuid (GCDR user); enums as text + CHECK; balance ALWAYS derived
// from inv_stock_movements (DEC-2, never stored). `customer_id` only where the
// record faces a customer (DEC-12). Advanced index shapes (covering INCLUDE,
// partial UNIQUE) are authoritative in the SQL migration; the ORM mirror below
// stays within Drizzle's expressible subset.
// ===========================================================================

// M1 — unified catalog (replaces 3 source families via `domain`, DEC-1).
export const invItems = pgTable('inv_items', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  name:           text('name').notNull(),
  // generated: lower(btrim(name)) — the uniqueness key (never write it).
  normalizedName: text('normalized_name').generatedAlwaysAs(sql`lower(btrim(name))`),
  domain:         text('domain').notNull(),              // COMPONENT | PRODUCT | THIRD_PARTY | TOOL
  link:           text('link'),
  description:    text('description'),
  isManufactured: boolean('is_manufactured').notNull().default(false),
  lossPercent:    numeric('loss_percent', { precision: 6, scale: 2 }).notNull().default('0'),
  lotQuantity:    integer('lot_quantity'),
  purchaseType:   text('purchase_type'),                 // NACIONAL | IMPORTACAO | null
  photoFileId:    uuid('photo_file_id').references(() => fileAssets.id, { onDelete: 'set null' }),
  active:         boolean('active').notNull().default(true),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid('created_by'),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:      uuid('updated_by'),
}, (table) => ({
  uq:          uniqueIndex('inv_items_uq').on(table.tenantId, table.domain, table.normalizedName),
  tenantIdx:   index('inv_items_tenant_idx').on(table.tenantId, table.domain),
  domainCheck: check('inv_items_domain_check', sql`${table.domain} IN ('COMPONENT','PRODUCT','THIRD_PARTY','TOOL')`),
  purchaseTypeCheck: check('inv_items_purchase_type_check', sql`${table.purchaseType} IS NULL OR ${table.purchaseType} IN ('NACIONAL','IMPORTACAO')`),
  // W4 invariant: only manufactured PRODUCTs may be is_manufactured.
  manufacturedCheck: check('inv_items_manufactured_check', sql`NOT ${table.isManufactured} OR ${table.domain} = 'PRODUCT'`),
}));

// M5 — single QR identity source (A2). Cross box×unit uniqueness by constraint.
export const invQrRegistry = pgTable('inv_qr_registry', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  qrValue:   text('qr_value').notNull(),
  kind:      text('kind').notNull(),                     // UNIT | BOX
  itemId:    uuid('item_id').references(() => invItems.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (table) => ({
  uq:        uniqueIndex('inv_qr_registry_uq').on(table.tenantId, table.qrValue),
  kindCheck: check('inv_qr_registry_kind_check', sql`${table.kind} IN ('UNIT','BOX')`),
}));

// M1 — BOM: product → component, loss factor applied at consumption time.
export const invBoms = pgTable('inv_boms', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull(),
  productItemId:   uuid('product_item_id').notNull().references(() => invItems.id, { onDelete: 'cascade' }),
  componentItemId: uuid('component_item_id').notNull().references(() => invItems.id, { onDelete: 'cascade' }),
  quantity:        numeric('quantity', { precision: 12, scale: 3 }).notNull(),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid('created_by'),
}, (table) => ({
  uq:          uniqueIndex('inv_boms_uq').on(table.productItemId, table.componentItemId),
  productIdx:  index('inv_boms_product_idx').on(table.tenantId, table.productItemId),
  qtyCheck:    check('inv_boms_quantity_check', sql`${table.quantity} > 0`),
}));

// M9 — projects; clients map onto GCDR customers (no new clients table).
export const invProjects = pgTable('inv_projects', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull(),
  name:             text('name').notNull(),
  description:      text('description'),
  customerId:       uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  legacyClientName: text('legacy_client_name'),
  legacyClientCnpj: text('legacy_client_cnpj'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid('created_by'),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:        uuid('updated_by'),
}, (table) => ({
  tenantIdx: index('inv_projects_tenant_idx').on(table.tenantId),
}));

// M3 — purchase orders (requests + buyer queue), server-side state machine.
export const invPurchaseOrders = pgTable('inv_purchase_orders', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull(),
  projectId:        uuid('project_id').notNull().references(() => invProjects.id, { onDelete: 'restrict' }),
  requesterId:      uuid('requester_id'),
  itemId:           uuid('item_id').notNull().references(() => invItems.id, { onDelete: 'restrict' }),
  itemNameSnapshot: text('item_name_snapshot'),
  itemLink:         text('item_link'),
  quantity:         integer('quantity').notNull(),
  recipient:        text('recipient'),
  deliveryPoint:    text('delivery_point'),
  status:           text('status').notNull().default('PENDENTE'),
  deadlineType:     text('deadline_type'),               // URGENTE | ESTA_SEMANA | ESTE_MES | CUSTOMIZADO
  deadlineDate:     timestamp('deadline_date', { withTimezone: true }),
  deliveryForecast: timestamp('delivery_forecast', { withTimezone: true }),
  requesterNotes:   text('requester_notes'),
  buyerNotes:       text('buyer_notes'),
  passphrase:       text('passphrase'),                  // spoken delivery word (DEC-10, plaintext)
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid('created_by'),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:        uuid('updated_by'),
}, (table) => ({
  tenantStatusIdx: index('inv_purchase_orders_status_idx').on(table.tenantId, table.status),
  projectIdx:      index('inv_purchase_orders_project_idx').on(table.tenantId, table.projectId),
  statusCheck: check('inv_purchase_orders_status_check', sql`${table.status} IN ('PENDENTE','COMPRADO_AGUARDANDO','ENTREGUE','RECEBIDO_OK','RECEBIDO_PROBLEMA','CANCELADO')`),
  deadlineTypeCheck: check('inv_purchase_orders_deadline_type_check', sql`${table.deadlineType} IS NULL OR ${table.deadlineType} IN ('URGENTE','ESTA_SEMANA','ESTE_MES','CUSTOMIZADO')`),
  quantityCheck: check('inv_purchase_orders_quantity_check', sql`${table.quantity} BETWEEN 1 AND 100000`),
}));

export const invPurchaseOrderFiles = pgTable('inv_purchase_order_files', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  orderId:   uuid('order_id').notNull().references(() => invPurchaseOrders.id, { onDelete: 'cascade' }),
  fileId:    uuid('file_id').notNull().references(() => fileAssets.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
}, (table) => ({
  orderIdx: index('inv_purchase_order_files_order_idx').on(table.orderId),
}));

// WO-style event model (RFC-0037) for the PO timeline (DEC-9).
export const invPurchaseOrderEvents = pgTable('inv_purchase_order_events', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  orderId:   uuid('order_id').notNull().references(() => invPurchaseOrders.id, { onDelete: 'cascade' }),
  actorId:   uuid('actor_id'),
  eventType: text('event_type').notNull(),               // CRIADO | STATUS_ALTERADO | OBSERVACAO_ATUALIZADA
  details:   jsonb('details').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderChronoIdx: index('inv_purchase_order_events_chrono_idx').on(table.orderId, table.createdAt),
  eventTypeCheck: check('inv_purchase_order_events_type_check', sql`${table.eventType} IN ('CRIADO','STATUS_ALTERADO','OBSERVACAO_ATUALIZADA')`),
}));

// M2 — event-sourced stock ledger (DEC-2/DEC-3). Balance derived, never stored.
export const invStockMovements = pgTable('inv_stock_movements', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull(),
  itemId:          uuid('item_id').notNull().references(() => invItems.id, { onDelete: 'restrict' }),
  location:        text('location').notNull(),           // FABRICA | ALMOXARIFADO | ALMOXARIFADO_GERAL
  quantity:        numeric('quantity', { precision: 12, scale: 3 }).notNull(),
  type:            text('type').notNull(),               // ENTRADA | SAIDA | AJUSTE | TRANSFERENCIA_IN | TRANSFERENCIA_OUT
  reason:          text('reason'),
  responsible:     text('responsible'),                  // technician name (free text)
  photoFileId:     uuid('photo_file_id').references(() => fileAssets.id, { onDelete: 'set null' }),
  purchaseOrderId: uuid('purchase_order_id').references(() => invPurchaseOrders.id, { onDelete: 'set null' }),
  transferGroupId: uuid('transfer_group_id'),            // pairs the two TRANSFERENCIA legs
  imported:        boolean('imported').notNull().default(false), // A5 --raw-ledger
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid('created_by'),
}, (table) => ({
  // Covering index (W2) — INCLUDE(quantity) is applied in the SQL migration.
  balanceIdx:  index('inv_stock_movements_balance_idx').on(table.tenantId, table.itemId, table.location, table.type),
  typeCheck:     check('inv_stock_movements_type_check', sql`${table.type} IN ('ENTRADA','SAIDA','AJUSTE','TRANSFERENCIA_IN','TRANSFERENCIA_OUT')`),
  locationCheck: check('inv_stock_movements_location_check', sql`${table.location} IN ('FABRICA','ALMOXARIFADO','ALMOXARIFADO_GERAL')`),
  quantityCheck: check('inv_stock_movements_quantity_check', sql`${table.quantity} > 0`),
}));

// M4 — production & assembly.
export const invAssemblyReleases = pgTable('inv_assembly_releases', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  photoFileId:  uuid('photo_file_id').notNull().references(() => fileAssets.id, { onDelete: 'restrict' }),
  responsibles: uuid('responsibles').array().notNull().default(sql`'{}'::uuid[]`),
  notes:        text('notes'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid('created_by'),
}, (table) => ({
  tenantIdx: index('inv_assembly_releases_tenant_idx').on(table.tenantId),
}));

export const invAssemblyReleaseItems = pgTable('inv_assembly_release_items', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull(),
  releaseId: uuid('release_id').notNull().references(() => invAssemblyReleases.id, { onDelete: 'cascade' }),
  itemId:    uuid('item_id').notNull().references(() => invItems.id, { onDelete: 'restrict' }),
  quantity:  integer('quantity').notNull(),
}, (table) => ({
  releaseIdx:    index('inv_assembly_release_items_release_idx').on(table.releaseId),
  quantityCheck: check('inv_assembly_release_items_quantity_check', sql`${table.quantity} > 0`),
}));

export const invAssemblyReleaseIssues = pgTable('inv_assembly_release_issues', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull(),
  releaseId:        uuid('release_id').notNull().references(() => invAssemblyReleases.id, { onDelete: 'cascade' }),
  releaseItemId:    uuid('release_item_id').references(() => invAssemblyReleaseItems.id, { onDelete: 'cascade' }),
  itemId:           uuid('item_id').references(() => invItems.id, { onDelete: 'set null' }),
  reportedQuantity: integer('reported_quantity'),
  message:          text('message'),
  status:           text('status').notNull().default('ABERTA'),
  resolutionNote:   text('resolution_note'),
  reportedBy:       uuid('reported_by'),
  resolvedBy:       uuid('resolved_by'),
  resolvedAt:       timestamp('resolved_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  releaseIdx:  index('inv_assembly_release_issues_release_idx').on(table.releaseId),
  statusCheck: check('inv_assembly_release_issues_status_check', sql`${table.status} IN ('ABERTA','RESOLVIDA')`),
}));

// M5 — homologation (boxes + units).
export const invHomologations = pgTable('inv_homologations', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull(),
  releaseId:     uuid('release_id').references(() => invAssemblyReleases.id, { onDelete: 'cascade' }),
  itemId:        uuid('item_id').notNull().references(() => invItems.id, { onDelete: 'cascade' }),
  boxSize:       integer('box_size').notNull(),          // 1 | 10 | 50 | 100 | 224
  boxQr:         text('box_qr'),
  responsibleId: uuid('responsible_id'),
  notes:         text('notes'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid('created_by'),
}, (table) => ({
  itemIdx:      index('inv_homologations_item_idx').on(table.tenantId, table.itemId),
  boxQrUq:      uniqueIndex('inv_homologations_box_qr_uq').on(table.tenantId, table.boxQr).where(sql`box_qr IS NOT NULL`),
  boxSizeCheck: check('inv_homologations_box_size_check', sql`${table.boxSize} IN (1,10,50,100,224)`),
}));

export const invHomologationUnits = pgTable('inv_homologation_units', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  homologationId: uuid('homologation_id').notNull().references(() => invHomologations.id, { onDelete: 'cascade' }),
  position:       integer('position'),
  qrValue:        text('qr_value').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  qrUq:          uniqueIndex('inv_homologation_units_qr_uq').on(table.tenantId, table.qrValue),
  homologIdx:    index('inv_homologation_units_homolog_idx').on(table.homologationId),
}));

// M2 — QR links per movement (anti-double-exit ledger). Declared after
// invHomologationUnits so its FK is a backward reference.
export const invMovementQrs = pgTable('inv_movement_qrs', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull(),
  movementId:         uuid('movement_id').notNull().references(() => invStockMovements.id, { onDelete: 'cascade' }),
  qrValue:            text('qr_value'),
  boxQr:              text('box_qr'),
  homologationUnitId: uuid('homologation_unit_id').references(() => invHomologationUnits.id, { onDelete: 'set null' }),
}, (table) => ({
  qrValueIdx:  index('inv_movement_qrs_qr_value_idx').on(table.qrValue),
  movementIdx: index('inv_movement_qrs_movement_idx').on(table.movementId),
}));

// M6 — expedition (Pedidos Myio), server-side state machine.
export const invExpeditionOrders = pgTable('inv_expedition_orders', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull(),
  title:         text('title'),
  projectId:     uuid('project_id').references(() => invProjects.id, { onDelete: 'restrict' }),
  customerId:    uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  deliveryDate:  timestamp('delivery_date', { withTimezone: true }).notNull(),
  status:        text('status').notNull().default('PENDENTE'),
  isReplacement: boolean('is_replacement').notNull().default(false),
  notes:         text('notes'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid('created_by'),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:     uuid('updated_by'),
}, (table) => ({
  tenantStatusIdx: index('inv_expedition_orders_status_idx').on(table.tenantId, table.status),
  statusCheck: check('inv_expedition_orders_status_check', sql`${table.status} IN ('PENDENTE','PRODUZINDO','PRONTO_ENTREGA','EM_TRANSITO','ENTREGUE_CLIENTE','PERDIDO')`),
}));

export const invExpeditionOrderItems = pgTable('inv_expedition_order_items', {
  id:       uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  orderId:  uuid('order_id').notNull().references(() => invExpeditionOrders.id, { onDelete: 'cascade' }),
  itemId:   uuid('item_id').notNull().references(() => invItems.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull(),
}, (table) => ({
  orderIdx:      index('inv_expedition_order_items_order_idx').on(table.orderId),
  quantityCheck: check('inv_expedition_order_items_quantity_check', sql`${table.quantity} > 0`),
}));

// M4 — demand resolution (delivered P3; schema in P0, A4).
export const invProductionDemands = pgTable('inv_production_demands', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull(),
  expeditionOrderItemId: uuid('expedition_order_item_id').notNull(),
  expeditionOrderId:     uuid('expedition_order_id').references(() => invExpeditionOrders.id, { onDelete: 'cascade' }),
  itemId:                uuid('item_id').references(() => invItems.id, { onDelete: 'set null' }),
  quantity:              integer('quantity').notNull(),
  status:                text('status').notNull().default('PENDENTE'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderItemUq: uniqueIndex('inv_production_demands_order_item_uq').on(table.expeditionOrderItemId),
  statusCheck: check('inv_production_demands_status_check', sql`${table.status} IN ('PENDENTE','CONCLUIDO')`),
}));

export const invPurchaseDemands = pgTable('inv_purchase_demands', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull(),
  expeditionOrderItemId: uuid('expedition_order_item_id').notNull(),
  expeditionOrderId:     uuid('expedition_order_id').references(() => invExpeditionOrders.id, { onDelete: 'cascade' }),
  purchaseOrderId:       uuid('purchase_order_id').references(() => invPurchaseOrders.id, { onDelete: 'set null' }),
  itemId:                uuid('item_id').references(() => invItems.id, { onDelete: 'set null' }),
  quantity:              integer('quantity').notNull(),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderItemUq: uniqueIndex('inv_purchase_demands_order_item_uq').on(table.expeditionOrderItemId),
}));

export const invItemDeliveries = pgTable('inv_item_deliveries', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  orderId:     uuid('order_id').notNull().references(() => invExpeditionOrders.id, { onDelete: 'cascade' }),
  orderItemId: uuid('order_item_id').notNull().references(() => invExpeditionOrderItems.id, { onDelete: 'cascade' }),
  quantity:    integer('quantity').notNull(),
  photoFileId: uuid('photo_file_id').notNull().references(() => fileAssets.id, { onDelete: 'restrict' }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid('created_by'),
}, (table) => ({
  orderIdx: index('inv_item_deliveries_order_idx').on(table.orderId),
}));

export const invDeliveryQrs = pgTable('inv_delivery_qrs', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull(),
  deliveryId:         uuid('delivery_id').notNull().references(() => invItemDeliveries.id, { onDelete: 'cascade' }),
  orderItemId:        uuid('order_item_id').notNull().references(() => invExpeditionOrderItems.id, { onDelete: 'cascade' }),
  qrValue:            text('qr_value'),
  boxQr:              text('box_qr'),
  homologationUnitId: uuid('homologation_unit_id').references((): AnyPgColumn => invHomologationUnits.id, { onDelete: 'set null' }),
}, (table) => ({
  qrValueIdx:  index('inv_delivery_qrs_qr_value_idx').on(table.qrValue),   // S5 — trace
  deliveryIdx: index('inv_delivery_qrs_delivery_idx').on(table.deliveryId),
}));

export const invShipments = pgTable('inv_shipments', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  orderId:        uuid('order_id').notNull().references(() => invExpeditionOrders.id, { onDelete: 'cascade' }),
  address:        text('address'),
  shippingMethod: text('shipping_method').notNull(),     // AZUL_CARGO | CORREIOS | CARRO_MYIO | UBER
  responsible:    text('responsible'),
  trackingCode:   text('tracking_code'),
  proofFileId:    uuid('proof_file_id').notNull().references(() => fileAssets.id, { onDelete: 'restrict' }),
  notes:          text('notes'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid('created_by'),
}, (table) => ({
  orderIdx:      index('inv_shipments_order_idx').on(table.orderId),
  methodCheck:   check('inv_shipments_method_check', sql`${table.shippingMethod} IN ('AZUL_CARGO','CORREIOS','CARRO_MYIO','UBER')`),
}));

// M7 — field (client / technician / damaged).
export const invUnitProducts = pgTable('inv_unit_products', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull(),
  itemId:             uuid('item_id').references(() => invItems.id, { onDelete: 'set null' }),
  label:              text('label'),                     // QR, unique per tenant when set
  status:             text('status').notNull().default('PARADO'),
  installedAt:        timestamp('installed_at', { withTimezone: true }),
  projectId:          uuid('project_id').references(() => invProjects.id, { onDelete: 'set null' }),
  customerId:         uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  clientNameSnapshot: text('client_name_snapshot'),
  expeditionOrderId:  uuid('expedition_order_id').references(() => invExpeditionOrders.id, { onDelete: 'set null' }),
  movedTo:            text('moved_to'),                  // TECNICO | ALMOXARIFADO | PERDIDO | AVARIADO
  movedTechnician:    text('moved_technician'),
  movePhotoFileId:    uuid('move_photo_file_id').references(() => fileAssets.id, { onDelete: 'set null' }),
  movedAt:            timestamp('moved_at', { withTimezone: true }),
  moveNotes:          text('move_notes'),
  notes:              text('notes'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid('created_by'),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  labelUq:      uniqueIndex('inv_unit_products_label_uq').on(table.tenantId, table.label).where(sql`label IS NOT NULL`),
  statusCheck:  check('inv_unit_products_status_check', sql`${table.status} IN ('PARADO','INSTALADO')`),
  movedToCheck: check('inv_unit_products_moved_to_check', sql`${table.movedTo} IS NULL OR ${table.movedTo} IN ('TECNICO','ALMOXARIFADO','PERDIDO','AVARIADO')`),
}));

export const invTechnicianMoves = pgTable('inv_technician_moves', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  movementId:  uuid('movement_id').references(() => invStockMovements.id, { onDelete: 'cascade' }),
  itemId:      uuid('item_id').references(() => invItems.id, { onDelete: 'cascade' }),
  technician:  text('technician'),
  destination: text('destination').notNull(),            // UNIDADE | PERDIDO | ALMOXARIFADO | AVARIADO
  projectId:   uuid('project_id').references(() => invProjects.id, { onDelete: 'set null' }),
  quantity:    integer('quantity').notNull(),
  notes:       text('notes'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid('created_by'),
}, (table) => ({
  itemIdx:          index('inv_technician_moves_item_idx').on(table.tenantId, table.itemId),
  destinationCheck: check('inv_technician_moves_destination_check', sql`${table.destination} IN ('UNIDADE','PERDIDO','ALMOXARIFADO','AVARIADO')`),
  quantityCheck:    check('inv_technician_moves_quantity_check', sql`${table.quantity} > 0`),
}));

export const invDamagedItems = pgTable('inv_damaged_items', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull(),
  itemId:             uuid('item_id').references(() => invItems.id, { onDelete: 'set null' }),
  productNameSnapshot: text('product_name_snapshot'),
  quantity:           integer('quantity').notNull(),
  source:             text('source'),
  sourceDetail:       text('source_detail'),
  reason:             text('reason'),
  photoFileId:        uuid('photo_file_id').references(() => fileAssets.id, { onDelete: 'set null' }),
  status:             text('status').notNull().default('AVARIADO'),
  recoveredTo:        text('recovered_to'),
  recoveryNotes:      text('recovery_notes'),
  recoveredBy:        uuid('recovered_by'),
  recoveredAt:        timestamp('recovered_at', { withTimezone: true }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid('created_by'),
}, (table) => ({
  tenantIdx:     index('inv_damaged_items_tenant_idx').on(table.tenantId, table.status),
  quantityCheck: check('inv_damaged_items_quantity_check', sql`${table.quantity} > 0`),
  statusCheck:   check('inv_damaged_items_status_check', sql`${table.status} IN ('AVARIADO','RECUPERADO')`),
}));

// M8 — external platform mirror + sync + push outbox.
export const invExternalStates = pgTable('inv_external_states', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull(),
  code:               text('code').notNull(),
  productType:        text('product_type'),
  location:           text('location'),
  status:             text('status'),
  technician:         text('technician'),
  clientName:         text('client_name'),
  qrValue:            text('qr_value'),
  itemId:             uuid('item_id').references(() => invItems.id, { onDelete: 'set null' }),
  homologationUnitId: uuid('homologation_unit_id').references((): AnyPgColumn => invHomologationUnits.id, { onDelete: 'set null' }),
  lastChangeAt:       timestamp('last_change_at', { withTimezone: true }),
  payload:            jsonb('payload'),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  codeUq:     uniqueIndex('inv_external_states_code_uq').on(table.tenantId, table.code),
  qrValueIdx: index('inv_external_states_qr_value_idx').on(table.qrValue),
}));

export const invExternalSyncState = pgTable('inv_external_sync_state', {
  tenantId:   uuid('tenant_id').primaryKey(),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  lastRunAt:  timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),                       // OK | PARCIAL | ERRO
  lastMessage: text('last_message'),
  totalItems: integer('total_items'),
}, (table) => ({
  statusCheck: check('inv_external_sync_state_status_check', sql`${table.lastStatus} IS NULL OR ${table.lastStatus} IN ('OK','PARCIAL','ERRO')`),
}));

export const invExternalPushOutbox = pgTable('inv_external_push_outbox', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull(),
  qrCodes:       text('qr_codes').array().notNull().default(sql`'{}'::text[]`),
  location:      text('location'),
  status:        text('status').notNull().default('PENDING'),
  technician:    text('technician'),
  clientName:    text('client_name'),
  attempts:      integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lastError:     text('last_error'),
  dispatchedAt:  timestamp('dispatched_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  drainIdx:    index('inv_external_push_outbox_drain_idx').on(table.tenantId, table.status, table.nextAttemptAt),
  statusCheck: check('inv_external_push_outbox_status_check', sql`${table.status} IN ('PENDING','FAILED','DONE')`),
}));
