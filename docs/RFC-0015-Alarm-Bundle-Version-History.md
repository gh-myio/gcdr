# RFC-0015: Alarm Bundle Version History & CRUD Cache Invalidation

- **Feature Name:** `alarm-bundle-version-history`
- **Start Date:** 2026-02-19
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Implemented
- **Authors:** MYIO Platform Team
- **Related RFCs:** [RFC-0008](./RFC-0008-Device-Attributes-Extension.md) (Device Attributes), [RFC-0014](./RFC-0014-FixSimulator.md) (Simulator)
- **Stakeholders:** Backend, Frontend, Node-RED, DevOps

---

## Summary

This RFC introduces two interconnected improvements to the alarm bundle system:

1. **`alarm_bundle_versions` table** -- A PostgreSQL table that records every new alarm bundle version with the reason for the change, the entity that triggered it, and who made the change.

2. **CRUD cache invalidation** -- Every mutation (create/update/delete) on entities that affect the alarm bundle (Rule, Device, Central, Asset, Customer) now immediately invalidates the in-memory cache, eliminating the previous 5-minute stale data window.

---

## Motivation

### Problem

The alarm bundle (`/simple` and `/full`) uses an in-memory cache with a 5-minute TTL. However, **no mutation** (create/update/delete of rule, device, central, asset, customer) invalidated this cache. As a result:

- Node-RED received stale data for up to 5 minutes after any change
- There was no record of **when** or **why** a bundle version changed
- No audit trail existed for bundle mutations
- It was impossible to correlate a rule change with a specific bundle version

### Previous Behavior

```
User creates rule ──> Rule saved to DB
                      Cache NOT invalidated
                      Node-RED polls bundle ──> Gets OLD bundle (up to 5 min)
                      TTL expires ──> Next request regenerates bundle
```

### New Behavior

```
User creates rule ──> Rule saved to DB
                      Cache INVALIDATED immediately
                      Node-RED polls bundle ──> Gets NEW bundle
                      Version recorded in alarm_bundle_versions
```

---

## Design

### 1. Database Table: `alarm_bundle_versions`

```sql
CREATE TABLE alarm_bundle_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  customer_id     UUID NOT NULL,

  -- Version info
  version           VARCHAR(50)  NOT NULL,   -- "v1-a1b2c3d4e5f6"
  previous_version  VARCHAR(50),             -- NULL on first generation
  bundle_type       VARCHAR(10)  NOT NULL,   -- "full" | "simple"

  -- Change tracking
  reason      VARCHAR(255) NOT NULL,  -- "rule_created", "device_updated", etc.
  entity_type VARCHAR(50)  NOT NULL,  -- "rule", "device", "central", "asset", "customer", "system"
  entity_id   UUID,                   -- ID of the entity that changed (NULL for system)

  -- Metadata
  rules_count   INTEGER NOT NULL DEFAULT 0,
  devices_count INTEGER NOT NULL DEFAULT 0,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID                     -- userId who caused the change
);

-- Indexes
CREATE INDEX abv_tenant_customer_idx ON alarm_bundle_versions (tenant_id, customer_id);
CREATE INDEX abv_version_idx         ON alarm_bundle_versions (version);
CREATE INDEX abv_created_at_idx      ON alarm_bundle_versions (created_at);
```

### 2. Invalidation Metadata

Each `invalidateCache` call now accepts an optional `InvalidationMeta` object:

```typescript
interface InvalidationMeta {
  reason: string;      // "rule_created", "device_updated", etc.
  entityType: string;  // "rule", "device", "central", "asset", "customer"
  entityId?: string;   // UUID of the entity that changed
  userId?: string;     // UUID of the user who made the change
}
```

This metadata is stored as `pendingInvalidation` on the service. When the next bundle is generated (on cache miss), the metadata is consumed and recorded in the `alarm_bundle_versions` table.

If no metadata is present (e.g., TTL expiration), the version is recorded with `reason: 'cache_expired'` and `entityType: 'system'`.

### 3. CRUD Services Connected

| Service | Methods | Reason Values |
|---------|---------|---------------|
| `RuleService` | create, update, delete, toggle | `rule_created`, `rule_updated`, `rule_deleted`, `rule_toggled` |
| `DeviceService` | create, update, delete | `device_created`, `device_updated`, `device_deleted` |
| `CentralService` | create, update, delete | `central_created`, `central_updated`, `central_deleted` |
| `AssetService` | create, update, delete | `asset_created`, `asset_updated`, `asset_deleted` |
| `CustomerService` | update, delete | `customer_updated`, `customer_deleted` |

### 4. Version Recording Flow

```
                 CRUD mutation occurs
                        │
                        ▼
              invalidateCache(tenantId,
                customerId, { reason, entityType, entityId, userId })
                        │
                        ▼
              Cache entries deleted
              pendingInvalidation stored
                        │
                        ▼
              Next GET /bundle/simple (cache miss)
                        │
                        ▼
              generateSimplifiedBundle()
                        │
                        ▼
              ┌─────────────────────────┐
              │  recordVersion()        │
              │  - Fetch latest version │
              │  - Insert new record    │
              │  - Consume pending meta │
              └─────────────────────────┘
                        │
                        ▼
              Bundle returned to client
              Version recorded in DB
```

### 5. Non-Blocking Design

Version recording is wrapped in a try/catch. If the database insert fails, the bundle is still returned normally -- version recording is non-critical and should never break bundle generation.

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `src/infrastructure/database/drizzle/schema.ts` | Modified | Added `alarmBundleVersions` table definition |
| `src/infrastructure/database/drizzle/db.ts` | Modified | Exported `AlarmBundleVersion` and `NewAlarmBundleVersion` types |
| `src/domain/entities/AlarmBundleVersion.ts` | **Created** | Entity interface |
| `src/repositories/AlarmBundleVersionRepository.ts` | **Created** | `record()`, `getLatest()`, `getHistory()` |
| `src/services/AlarmBundleService.ts` | Modified | Added `InvalidationMeta`, `pendingInvalidation`, `recordVersion()`, `getVersionHistory()` |
| `src/services/RuleService.ts` | Modified | Added `invalidateCache` after create/update/delete/toggle |
| `src/services/DeviceService.ts` | Modified | Added `invalidateCache` after create/update/delete |
| `src/services/CentralService.ts` | Modified | Added `invalidateCache` after create/update/delete |
| `src/services/AssetService.ts` | Modified | Added `invalidateCache` after create/update/delete |
| `src/services/CustomerService.ts` | Modified | Added `invalidateCache` after update/delete |
| `drizzle/migrations/0005_glamorous_rafael_vega.sql` | **Created** | Auto-generated migration |
| `scripts/db/seeds/17-alarm-bundle-versions.sql` | **Created** | Seed data with 5 example records |
| `scripts/db/seeds/99-verify-all.sql` | Modified | Added `alarm_bundle_versions` to verification |

---

## Migration

### SQL (run manually in Dokploy or via psql)

```sql
CREATE TABLE "alarm_bundle_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "version" varchar(50) NOT NULL,
  "previous_version" varchar(50),
  "bundle_type" varchar(10) NOT NULL,
  "reason" varchar(255) NOT NULL,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" uuid,
  "rules_count" integer DEFAULT 0 NOT NULL,
  "devices_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid
);

CREATE INDEX "abv_tenant_customer_idx" ON "alarm_bundle_versions" USING btree ("tenant_id","customer_id");
CREATE INDEX "abv_version_idx" ON "alarm_bundle_versions" USING btree ("version");
CREATE INDEX "abv_created_at_idx" ON "alarm_bundle_versions" USING btree ("created_at");
```

### CLI alternatives

```bash
npm run db:push       # Drizzle push (syncs schema directly)
npm run db:migrate    # Drizzle migrate (runs migration files)
```

---

## API Changes

### Existing Endpoints (behavior change)

| Endpoint | Change |
|----------|--------|
| `GET /customers/:id/alarm-rules/bundle/simple` | Now records version in `alarm_bundle_versions` on cache miss |
| `GET /customers/:id/alarm-rules/bundle` | Same as above |

The response format is **unchanged**. The version recording happens server-side and is transparent to the client.

### New Method (service-level, no route yet)

```typescript
alarmBundleService.getVersionHistory(tenantId, customerId, limit?)
// Returns: AlarmBundleVersion[]
```

This can be exposed as a REST endpoint in a future iteration if needed (e.g., `GET /customers/:id/alarm-rules/bundle/versions`).

---

## Future Considerations

1. **REST endpoint for version history** -- Expose `getVersionHistory` as `GET /customers/:id/alarm-rules/bundle/versions` for admin/dashboard use
2. **Webhook notifications** -- Notify Node-RED via webhook when a bundle version changes, instead of relying on polling
3. **Diff between versions** -- Store a summary of what changed (added/removed rules, changed devices)
4. **Retention policy** -- Auto-cleanup old version records (e.g., keep last 90 days)
5. **Multi-instance invalidation** -- When running multiple GCDR instances, use Redis pub/sub to propagate cache invalidation across instances

---

## Verification

1. `npm run build` -- TypeScript compilation passes
2. `npm run db:generate` -- Migration generated: `0005_glamorous_rafael_vega.sql`
3. Run migration on database
4. Test flow:
   - `GET /customers/:id/alarm-rules/bundle/simple` -> 200, version recorded
   - `POST /rules` (create rule) -> cache invalidated
   - `GET /customers/:id/alarm-rules/bundle/simple` -> 200, **new version**, recorded with `reason: 'rule_created'`
   - Same GET with `If-None-Match` header matching new version -> 304
   - Query `alarm_bundle_versions` table to see history
