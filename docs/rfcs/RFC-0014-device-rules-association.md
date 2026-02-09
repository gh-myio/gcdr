# RFC-0014: Device Rules Association and Version Control

- **Feature Name:** device_rules_association
- **Start Date:** 2026-02-09
- **RFC PR:** (leave this empty until PR is created)
- **Issue:** (leave this empty until issue is created)
- **Status:** Draft

## Summary

This RFC proposes two interconnected features for the GCDR alarm rules system:

1. **Device-Rules Association Table (N:N):** A junction table enabling flexible many-to-many associations between devices and rules, replacing the current hierarchical scope-based model.

2. **Rules Version Control:** A centralized version tracking system that increments whenever rules or device-rule associations are created, updated, or deleted, enabling efficient cache invalidation for alarm bundles.

## Motivation

### Current Limitations

The existing rule-device relationship model uses a hierarchical scope system:

```typescript
scope: {
  type: 'GLOBAL' | 'CUSTOMER' | 'ASSET' | 'DEVICE',
  entityId?: string,
  inherited?: boolean
}
```

This approach has significant limitations:

1. **No Multi-Device Selection:** A rule with `scope.type = 'DEVICE'` can only target ONE specific device. There is no way to apply a rule to devices A, B, and C but not D without creating three separate rules.

2. **All-or-Nothing Granularity:** Users must choose between applying a rule to ALL devices (GLOBAL/CUSTOMER/ASSET) or exactly ONE device. There is no middle ground.

3. **Rule Duplication:** To apply the same alarm threshold to 5 specific devices, users must create 5 identical rules with different `scope.entityId` values, leading to maintenance burden and data inconsistency risks.

4. **No Version Tracking:** There is no centralized mechanism to know when rules have changed. The current `version` field on each entity is for optimistic locking, not for tracking global changes. This makes cache invalidation for alarm bundles inefficient.

5. **Bundle Regeneration:** The `AlarmBundleService` must regenerate bundles on every request because there is no reliable way to know if the underlying rules have changed.

### Use Cases

1. **Selective Device Targeting:** A building manager wants to apply a "High Temperature" alarm rule to sensors in server rooms only (5 out of 50 devices).

2. **Device Group Rules:** Apply maintenance window rules to a specific set of devices undergoing scheduled maintenance.

3. **Efficient Polling:** Edge devices (Node-RED, NodeHUB) poll for alarm bundles periodically. With version control, they can use `If-None-Match` headers effectively and receive `304 Not Modified` when nothing has changed.

4. **Audit Trail:** Track when rule configurations affecting devices were last modified for compliance and debugging purposes.

## Guide-level Explanation

### Device-Rules Association

Instead of defining scope inside each rule, users will be able to explicitly associate rules with devices through a dedicated endpoint:

```http
POST /api/v1/device-rules
{
  "deviceId": "device-uuid",
  "ruleId": "rule-uuid",
  "priority": 1,
  "enabled": true
}
```

Or associate multiple devices at once:

```http
POST /api/v1/rules/:ruleId/devices
{
  "deviceIds": ["device-1", "device-2", "device-3"],
  "priority": 1,
  "enabled": true
}
```

Rules can still have a `scope` for backwards compatibility and for truly global rules, but explicit device associations take precedence.

### Version Control

A new `rule_versions` table tracks changes:

```
rule_versions
├── id (uuid)
├── tenant_id (uuid)
├── customer_id (uuid)
├── version (bigint, auto-increment per customer)
├── change_type (enum: RULE_CREATED, RULE_UPDATED, RULE_DELETED, ASSOCIATION_CREATED, ASSOCIATION_DELETED)
├── entity_id (uuid) - the rule or association that changed
├── changed_by (uuid)
├── changed_at (timestamp)
└── metadata (jsonb) - additional context
```

The `AlarmBundleService` can now:

1. Query the latest version for a customer
2. Compare with the client's `If-None-Match` header
3. Return `304 Not Modified` if versions match
4. Only regenerate the bundle when versions differ

### API Flow Example

```
Client                                  Server
  │                                       │
  │  GET /alarm-rules/bundle              │
  │  If-None-Match: "v42"                 │
  │ ─────────────────────────────────────>│
  │                                       │
  │     ┌─────────────────────────────┐   │
  │     │ Check rule_versions table   │   │
  │     │ Latest version = 42         │   │
  │     │ Client version = 42         │   │
  │     │ Match! Return 304           │   │
  │     └─────────────────────────────┘   │
  │                                       │
  │  304 Not Modified                     │
  │ <─────────────────────────────────────│
  │                                       │
```

## Reference-level Explanation

### Database Schema

#### Table: `device_rules`

```sql
CREATE TABLE device_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,

  -- Association metadata
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,

  -- Optional overrides (allows device-specific tweaks to rule parameters)
  config_overrides JSONB,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,

  -- Constraints
  CONSTRAINT device_rules_unique UNIQUE (tenant_id, device_id, rule_id)
);

-- Indexes
CREATE INDEX device_rules_tenant_device_idx ON device_rules(tenant_id, device_id);
CREATE INDEX device_rules_tenant_rule_idx ON device_rules(tenant_id, rule_id);
CREATE INDEX device_rules_enabled_idx ON device_rules(tenant_id, enabled);
```

#### Table: `rule_versions`

```sql
CREATE TABLE rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),

  -- Version tracking
  version BIGINT NOT NULL,

  -- Change information
  change_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL, -- 'rule' or 'device_rule'
  entity_id UUID NOT NULL,

  -- Audit
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Additional context
  metadata JSONB NOT NULL DEFAULT '{}',

  -- Constraints
  CONSTRAINT rule_versions_customer_version_unique UNIQUE (tenant_id, customer_id, version)
);

-- Indexes
CREATE INDEX rule_versions_tenant_customer_idx ON rule_versions(tenant_id, customer_id);
CREATE INDEX rule_versions_changed_at_idx ON rule_versions(changed_at);

-- Sequence per customer (handled in application layer)
```

#### Drizzle Schema

```typescript
// device_rules table
export const deviceRules = pgTable('device_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  ruleId: uuid('rule_id').notNull().references(() => rules.id, { onDelete: 'cascade' }),

  // Association metadata
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),

  // Optional overrides
  configOverrides: jsonb('config_overrides'),

  // Audit
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
}, (table) => ({
  tenantDeviceRuleUnique: uniqueIndex('device_rules_unique').on(table.tenantId, table.deviceId, table.ruleId),
  tenantDeviceIdx: index('device_rules_tenant_device_idx').on(table.tenantId, table.deviceId),
  tenantRuleIdx: index('device_rules_tenant_rule_idx').on(table.tenantId, table.ruleId),
  enabledIdx: index('device_rules_enabled_idx').on(table.tenantId, table.enabled),
}));

// rule_versions table
export const ruleVersions = pgTable('rule_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),

  // Version tracking
  version: bigint('version', { mode: 'number' }).notNull(),

  // Change information
  changeType: varchar('change_type', { length: 50 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),

  // Audit
  changedBy: uuid('changed_by'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),

  // Additional context
  metadata: jsonb('metadata').notNull().default({}),
}, (table) => ({
  customerVersionUnique: uniqueIndex('rule_versions_customer_version_unique').on(table.tenantId, table.customerId, table.version),
  tenantCustomerIdx: index('rule_versions_tenant_customer_idx').on(table.tenantId, table.customerId),
  changedAtIdx: index('rule_versions_changed_at_idx').on(table.changedAt),
}));
```

### Change Type Enum

```typescript
export const RuleChangeType = {
  RULE_CREATED: 'RULE_CREATED',
  RULE_UPDATED: 'RULE_UPDATED',
  RULE_DELETED: 'RULE_DELETED',
  RULE_ENABLED: 'RULE_ENABLED',
  RULE_DISABLED: 'RULE_DISABLED',
  ASSOCIATION_CREATED: 'ASSOCIATION_CREATED',
  ASSOCIATION_UPDATED: 'ASSOCIATION_UPDATED',
  ASSOCIATION_DELETED: 'ASSOCIATION_DELETED',
} as const;
```

### Service Layer

#### RuleVersionService

```typescript
export class RuleVersionService {
  /**
   * Get the current version for a customer's rules
   */
  async getCurrentVersion(tenantId: string, customerId: string): Promise<number> {
    const result = await db
      .select({ version: max(ruleVersions.version) })
      .from(ruleVersions)
      .where(and(
        eq(ruleVersions.tenantId, tenantId),
        eq(ruleVersions.customerId, customerId)
      ));

    return result[0]?.version ?? 0;
  }

  /**
   * Increment version and record change
   */
  async recordChange(params: {
    tenantId: string;
    customerId: string;
    changeType: string;
    entityType: 'rule' | 'device_rule';
    entityId: string;
    changedBy?: string;
    metadata?: Record<string, unknown>;
  }): Promise<number> {
    const currentVersion = await this.getCurrentVersion(params.tenantId, params.customerId);
    const newVersion = currentVersion + 1;

    await db.insert(ruleVersions).values({
      tenantId: params.tenantId,
      customerId: params.customerId,
      version: newVersion,
      changeType: params.changeType,
      entityType: params.entityType,
      entityId: params.entityId,
      changedBy: params.changedBy,
      metadata: params.metadata ?? {},
    });

    return newVersion;
  }
}
```

#### DeviceRuleService

```typescript
export class DeviceRuleService {
  /**
   * Associate a rule with a device
   */
  async associate(params: {
    tenantId: string;
    deviceId: string;
    ruleId: string;
    priority?: number;
    enabled?: boolean;
    configOverrides?: Record<string, unknown>;
    userId: string;
  }): Promise<DeviceRule> {
    // Validate device and rule exist
    const device = await this.deviceRepository.getById(params.tenantId, params.deviceId);
    if (!device) throw new NotFoundError(`Device ${params.deviceId} not found`);

    const rule = await this.ruleRepository.getById(params.tenantId, params.ruleId);
    if (!rule) throw new NotFoundError(`Rule ${params.ruleId} not found`);

    // Create association
    const association = await this.repository.create({
      tenantId: params.tenantId,
      deviceId: params.deviceId,
      ruleId: params.ruleId,
      priority: params.priority ?? 0,
      enabled: params.enabled ?? true,
      configOverrides: params.configOverrides,
      createdBy: params.userId,
    });

    // Record version change
    await this.versionService.recordChange({
      tenantId: params.tenantId,
      customerId: device.customerId,
      changeType: RuleChangeType.ASSOCIATION_CREATED,
      entityType: 'device_rule',
      entityId: association.id,
      changedBy: params.userId,
      metadata: { deviceId: params.deviceId, ruleId: params.ruleId },
    });

    return association;
  }

  /**
   * Associate multiple devices with a rule
   */
  async associateMultiple(params: {
    tenantId: string;
    ruleId: string;
    deviceIds: string[];
    priority?: number;
    enabled?: boolean;
    userId: string;
  }): Promise<DeviceRule[]> {
    const results: DeviceRule[] = [];

    for (const deviceId of params.deviceIds) {
      const association = await this.associate({
        tenantId: params.tenantId,
        deviceId,
        ruleId: params.ruleId,
        priority: params.priority,
        enabled: params.enabled,
        userId: params.userId,
      });
      results.push(association);
    }

    return results;
  }

  /**
   * Get all rules for a device
   */
  async getRulesForDevice(tenantId: string, deviceId: string): Promise<Rule[]> {
    return this.repository.getRulesByDevice(tenantId, deviceId);
  }

  /**
   * Get all devices for a rule
   */
  async getDevicesForRule(tenantId: string, ruleId: string): Promise<Device[]> {
    return this.repository.getDevicesByRule(tenantId, ruleId);
  }
}
```

### Updated AlarmBundleService

```typescript
export class AlarmBundleService {
  /**
   * Generate bundle with version-aware caching
   */
  async generateBundle(params: GenerateBundleParams): Promise<AlarmRulesBundle> {
    const { tenantId, customerId } = params;

    // Get current version
    const currentVersion = await this.versionService.getCurrentVersion(tenantId, customerId);

    // ... existing bundle generation logic ...

    // Use version in meta
    const meta: BundleMeta = {
      version: `v${currentVersion}`,
      // ... other fields
    };

    return bundle;
  }

  /**
   * Get applicable rules including explicit associations
   */
  private async getApplicableRules(device: Device, rules: Rule[]): Promise<string[]> {
    const applicableRuleIds: string[] = [];

    // 1. Get explicitly associated rules (highest priority)
    const associations = await this.deviceRuleRepository.getByDevice(device.tenantId, device.id);
    for (const assoc of associations) {
      if (assoc.enabled) {
        applicableRuleIds.push(assoc.ruleId);
      }
    }

    // 2. Get scope-based rules (for backwards compatibility)
    for (const rule of rules) {
      // Skip if already explicitly associated
      if (applicableRuleIds.includes(rule.id)) continue;

      // ... existing scope-based logic ...
    }

    return applicableRuleIds;
  }
}
```

### API Endpoints

#### Device-Rules Association

```typescript
// POST /api/v1/device-rules
router.post('/', async (req, res, next) => {
  const { tenantId, userId } = req.context;
  const data = CreateDeviceRuleSchema.parse(req.body);
  const result = await deviceRuleService.associate({ ...data, tenantId, userId });
  sendCreated(res, result);
});

// POST /api/v1/rules/:ruleId/devices
router.post('/:ruleId/devices', async (req, res, next) => {
  const { tenantId, userId } = req.context;
  const { ruleId } = req.params;
  const { deviceIds, priority, enabled } = req.body;
  const results = await deviceRuleService.associateMultiple({
    tenantId, ruleId, deviceIds, priority, enabled, userId
  });
  sendCreated(res, { items: results, count: results.length });
});

// GET /api/v1/devices/:deviceId/rules
router.get('/:deviceId/rules', async (req, res, next) => {
  const { tenantId } = req.context;
  const { deviceId } = req.params;
  const rules = await deviceRuleService.getRulesForDevice(tenantId, deviceId);
  sendSuccess(res, { items: rules, count: rules.length });
});

// GET /api/v1/rules/:ruleId/devices
router.get('/:ruleId/devices', async (req, res, next) => {
  const { tenantId } = req.context;
  const { ruleId } = req.params;
  const devices = await deviceRuleService.getDevicesForRule(tenantId, ruleId);
  sendSuccess(res, { items: devices, count: devices.length });
});

// DELETE /api/v1/device-rules/:id
router.delete('/:id', async (req, res, next) => {
  const { tenantId, userId } = req.context;
  const { id } = req.params;
  await deviceRuleService.dissociate(tenantId, id, userId);
  sendNoContent(res);
});
```

#### Version Endpoint

```typescript
// GET /api/v1/customers/:customerId/rules/version
router.get('/:customerId/rules/version', async (req, res, next) => {
  const { tenantId } = req.context;
  const { customerId } = req.params;
  const version = await ruleVersionService.getCurrentVersion(tenantId, customerId);
  sendSuccess(res, { version, versionId: `v${version}` });
});
```

## Drawbacks

1. **Migration Complexity:** Existing rules with `scope.type = 'DEVICE'` need to be migrated to explicit associations.

2. **Increased Storage:** The `device_rules` junction table adds storage overhead, especially for customers with many devices.

3. **Query Complexity:** Fetching applicable rules now requires joining with the `device_rules` table.

4. **Backwards Compatibility:** The scope-based system must be maintained for backwards compatibility, increasing code complexity.

## Rationale and Alternatives

### Why this design?

1. **Explicit over Implicit:** Explicit associations are easier to understand, debug, and audit than hierarchical scope inheritance.

2. **Flexibility:** Users can now target any arbitrary set of devices without rule duplication.

3. **Performance:** Version-based caching dramatically reduces bundle regeneration for polling clients.

### Alternatives Considered

#### Alternative 1: Tags-based Association

Instead of a junction table, use tags on devices and rules to match them:

```json
// Rule
{ "tags": ["server-room", "high-temp"] }

// Device
{ "tags": ["server-room"] }
```

**Rejected because:**
- Tag matching is less explicit and harder to audit
- No way to track when associations change
- Complex queries for tag intersection

#### Alternative 2: Device Groups

Create a `device_groups` table and associate rules with groups:

```
rule -> device_group -> devices
```

**Rejected because:**
- Adds another layer of indirection
- Users may not want to create groups for one-off associations
- Can be added later as an enhancement on top of this RFC

#### Alternative 3: Multi-value Scope

Extend scope to support multiple entity IDs:

```json
{
  "scope": {
    "type": "DEVICE",
    "entityIds": ["device-1", "device-2", "device-3"]
  }
}
```

**Rejected because:**
- Breaks the existing scope contract
- Cannot track individual device association changes
- No support for per-device overrides

## Prior Art

- **AWS IAM:** Uses explicit policy attachments to users/roles/groups
- **Kubernetes RBAC:** RoleBindings explicitly associate roles with subjects
- **ThingsBoard:** Uses relations table for device-asset-rule associations
- **Home Assistant:** Automations explicitly list target entities

## Unresolved Questions

1. **Migration Strategy:** Should existing `scope.type = 'DEVICE'` rules be automatically migrated to explicit associations, or should both systems coexist indefinitely?

2. **Config Overrides:** What parameters should be allowed in `config_overrides`? Should it be schema-validated or freeform JSONB?

3. **Cascade Behavior:** When a rule is deleted, should all associations be deleted (CASCADE) or should deletion be blocked if associations exist (RESTRICT)?

4. **Version Retention:** How long should version history be retained? Should there be a cleanup job for old versions?

## Future Possibilities

1. **Device Groups:** Add a `device_groups` table that can be associated with rules, enabling "apply rule to group" functionality.

2. **Rule Templates:** Create rule templates that can be instantiated with different parameters for different devices.

3. **Bulk Operations API:** Add endpoints for bulk association/dissociation operations.

4. **Version Diff API:** Add an endpoint to get changes between two versions for debugging.

5. **Webhooks:** Notify external systems when rule versions change.

## Implementation Plan

### Phase 1: Database Schema (Week 1)
- [ ] Add `device_rules` table migration
- [ ] Add `rule_versions` table migration
- [ ] Add Drizzle schema definitions

### Phase 2: Core Services (Week 2)
- [ ] Implement `RuleVersionService`
- [ ] Implement `DeviceRuleService`
- [ ] Implement `DeviceRuleRepository`

### Phase 3: Integration (Week 3)
- [ ] Update `RuleService` to record version changes
- [ ] Update `AlarmBundleService` to use explicit associations
- [ ] Add version-based ETag support

### Phase 4: API & Testing (Week 4)
- [ ] Add device-rules controller and routes
- [ ] Add version endpoint
- [ ] Write unit tests
- [ ] Write integration tests

### Phase 5: Migration & Documentation (Week 5)
- [ ] Create migration script for existing DEVICE-scoped rules
- [ ] Update API documentation
- [ ] Update Swagger/OpenAPI specs
