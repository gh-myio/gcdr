# RFC-0016: ThingsBoard Entity Mapping & Ingestion IDs for Customers and Assets

- **Feature Name:** `thingsboard-entity-mapping`
- **Start Date:** 2026-02-19
- **RFC PR:** (leave this empty until the PR is created)
- **Tracking Issue:** (leave this empty until an issue is created)
- **Status:** Draft
- **Authors:** MYIO Platform Team
- **Related RFCs:** [RFC-0001](./RFC-0001-GCDR-MYIO-Integration-Marketplace.md) (Integration Marketplace), [RFC-0003](./RFC-0003-Refactoring-Multiple-Audience.md) (Multiple Audience), [RFC-0008](./RFC-0008-Device-Attributes-Extension.md) (Device Attributes)
- **Stakeholders:** Backend, Frontend, ThingsBoard Integration, DevOps

---

## Summary

This RFC extends the GCDR entity model so that **Customer**, **Asset**, and **Device** all carry a consistent pair of external-system identifiers:

1. **`ingestionId`** -- UUID referencing the entity in the MYIO ingestion/data pipeline system.
2. **`thingsboardId`** -- UUID referencing the corresponding entity in ThingsBoard.

Devices already have `ingestionId` (RFC-0008) and `externalId` (a free-form varchar). This RFC:

- Adds `ingestionId` and `thingsboardId` to **Customer** and **Asset**.
- Adds a dedicated `thingsboardId` column to **Device** (replacing the overloaded `externalId` for ThingsBoard-specific use cases).
- Introduces a new `ApiKeyScope` value (`sync:write`) for ThingsBoard integration.
- Seeds a dedicated ThingsBoard integration API key with the `thingsboard` audience.
- Updates DTOs, repositories, seeds, and documentation across all three entities.

---

## Motivation

### Problem

GCDR is the **master data system** for the MYIO platform (RFC-0001). Customers, Assets, and Devices in GCDR must be synchronized bidirectionally with:

1. **ThingsBoard** -- The IoT platform that manages device connectivity, telemetry ingestion, and dashboards. ThingsBoard has its own entity model (TB Customers, TB Assets, TB Devices), each identified by a UUID.
2. **Ingestion Pipeline** -- The MYIO data pipeline that processes raw telemetry. Each entity has a pipeline-internal UUID.

Currently, the mapping situation is inconsistent:

| Entity | `ingestionId` | ThingsBoard ID | Status |
|--------|---------------|----------------|--------|
| **Customer** | -- | -- | No mapping at all |
| **Asset** | -- | -- | No mapping at all |
| **Device** | `ingestionId` (UUID) | `externalId` (varchar, free-form) | Partial -- `externalId` is not typed as UUID and not ThingsBoard-specific |

This inconsistency creates problems:

1. **No Customer/Asset sync** -- When a customer or asset is created in GCDR, there is no structured field to store the corresponding ThingsBoard entity ID. Integrations must resort to storing IDs in the `metadata` JSONB blob, which is unindexed, untyped, and invisible to queries.

2. **Ambiguous `externalId`** -- The Device `externalId` field is documented as "ThingsBoard ID or other external system ID". Seeds contain values like `tb-device-temp-001` (a label, not a UUID). There is no enforcement that this is actually a ThingsBoard UUID.

3. **No integration API key for ThingsBoard** -- The existing seed API keys target Node-RED and alarm orchestration use cases. There is no dedicated key for ThingsBoard sync operations that would allow the ThingsBoard connector to push entity mappings back to GCDR.

4. **JWT Audience gap** -- RFC-0003 added `alarm-orchestrator` to the JWT audience list. ThingsBoard integration services also need token validation, requiring a `thingsboard-connector` audience.

### Use Cases

1. **Entity Sync Pipeline**: When GCDR creates a Customer, the ThingsBoard connector creates a matching TB Customer and writes back the `thingsboardId` to GCDR. Same for Assets and Devices.

2. **Reverse Lookup**: Given a ThingsBoard device UUID (e.g., from a TB alarm callback), quickly find the corresponding GCDR device.

3. **Ingestion Correlation**: The ingestion pipeline references entities by `ingestionId`. Customer and Asset currently lack this, breaking the chain for pipeline-level aggregation.

4. **Audit & Debugging**: When a ThingsBoard alarm fires, the support team needs to trace it back to the GCDR entity. A dedicated, indexed `thingsboardId` column makes this instant instead of requiring JSONB queries.

---

## Guide-level Explanation

### For Frontend Developers

Three new optional fields appear on Customer, Asset, and Device responses:

```json
{
  "id": "gcdr-uuid",
  "name": "ACME Tech",
  "ingestionId": "pipeline-uuid-or-null",
  "thingsboardId": "tb-uuid-or-null",
  ...
}
```

These fields are **read-only** for most users. They are populated by the ThingsBoard connector and ingestion pipeline via the integration API key.

### For Integration Developers

The ThingsBoard connector uses a dedicated API key (`gcdr_cust_tb_integration_key_2026`) with scopes:

```
customers:read, customers:write, assets:read, assets:write,
devices:read, devices:write, sync:write
```

The `sync:write` scope grants permission to update integration-specific fields (`ingestionId`, `thingsboardId`) on any entity the key has write access to.

### For Backend Developers

Each entity gains two new nullable UUID columns:

```sql
ALTER TABLE customers ADD COLUMN ingestion_id UUID;
ALTER TABLE customers ADD COLUMN thingsboard_id UUID;

ALTER TABLE assets ADD COLUMN ingestion_id UUID;
ALTER TABLE assets ADD COLUMN thingsboard_id UUID;

ALTER TABLE devices ADD COLUMN thingsboard_id UUID;
-- devices.ingestion_id already exists (RFC-0008)
```

---

## Reference-level Explanation

### 1. Database Schema Changes

#### 1a. `customers` table

```sql
ALTER TABLE customers
  ADD COLUMN ingestion_id UUID,
  ADD COLUMN thingsboard_id UUID;

CREATE INDEX idx_customers_ingestion_id ON customers (tenant_id, ingestion_id) WHERE ingestion_id IS NOT NULL;
CREATE INDEX idx_customers_thingsboard_id ON customers (tenant_id, thingsboard_id) WHERE thingsboard_id IS NOT NULL;
```

#### 1b. `assets` table

```sql
ALTER TABLE assets
  ADD COLUMN ingestion_id UUID,
  ADD COLUMN thingsboard_id UUID;

CREATE INDEX idx_assets_ingestion_id ON assets (tenant_id, ingestion_id) WHERE ingestion_id IS NOT NULL;
CREATE INDEX idx_assets_thingsboard_id ON assets (tenant_id, thingsboard_id) WHERE thingsboard_id IS NOT NULL;
```

#### 1c. `devices` table

```sql
ALTER TABLE devices
  ADD COLUMN thingsboard_id UUID;
-- ingestion_id already exists from RFC-0008

CREATE INDEX idx_devices_thingsboard_id ON devices (tenant_id, thingsboard_id) WHERE thingsboard_id IS NOT NULL;
```

**Note:** The existing `external_id` (varchar) column is **NOT removed** for backwards compatibility. It can continue to hold non-ThingsBoard external references. Over time, ThingsBoard-specific values should migrate from `external_id` to `thingsboard_id`.

### 2. Domain Entity Changes

#### Customer (`src/domain/entities/Customer.ts`)

```typescript
export interface Customer extends BaseEntity {
  // ... existing fields ...

  // Integration Mapping
  ingestionId?: string;     // UUID in ingestion pipeline
  thingsboardId?: string;   // UUID in ThingsBoard
}
```

#### Asset (`src/domain/entities/Asset.ts`)

```typescript
export interface Asset extends BaseEntity {
  // ... existing fields ...

  // Integration Mapping
  ingestionId?: string;     // UUID in ingestion pipeline
  thingsboardId?: string;   // UUID in ThingsBoard
}
```

#### Device (`src/domain/entities/Device.ts`)

```typescript
export interface Device extends BaseEntity {
  // ... existing fields ...
  ingestionId?: string;       // Already exists (RFC-0008)
  thingsboardId?: string;     // NEW: UUID in ThingsBoard
}
```

### 3. Drizzle Schema Changes (`src/infrastructure/database/drizzle/schema.ts`)

Add to the `customers` table definition:

```typescript
ingestionId: uuid('ingestion_id'),
thingsboardId: uuid('thingsboard_id'),
```

Add to the `assets` table definition:

```typescript
ingestionId: uuid('ingestion_id'),
thingsboardId: uuid('thingsboard_id'),
```

Add to the `devices` table definition:

```typescript
thingsboardId: uuid('thingsboard_id'),
```

### 4. DTO Changes

#### Request DTOs

**`src/dto/request/CustomerDTO.ts`:**

```typescript
// Add to CreateCustomerSchema and UpdateCustomerSchema:
ingestionId: z.string().uuid().optional().nullable(),
thingsboardId: z.string().uuid().optional().nullable(),
```

**`src/dto/request/AssetDTO.ts`:**

```typescript
// Add to CreateAssetSchema and UpdateAssetSchema:
ingestionId: z.string().uuid().optional().nullable(),
thingsboardId: z.string().uuid().optional().nullable(),
```

**`src/dto/request/DeviceDTO.ts`:**

```typescript
// Add to CreateDeviceSchema and UpdateDeviceSchema (ingestionId already present):
thingsboardId: z.string().uuid().optional().nullable(),
```

#### Response DTOs

**`src/dto/response/CustomerResponseDTO.ts`:**

```typescript
export interface CustomerResponseDTO {
  // ... existing fields ...
  ingestionId?: string | null;
  thingsboardId?: string | null;
}

// Update toCustomerResponseDTO() mapper
```

**`src/dto/response/AssetResponseDTO.ts`:**

```typescript
export interface AssetResponseDTO {
  // ... existing fields ...
  ingestionId?: string | null;
  thingsboardId?: string | null;
}

// Update toAssetResponse() mapper
```

**`src/dto/response/DeviceResponseDTO.ts`:**

```typescript
export interface DeviceResponseDTO {
  // ... existing fields ...
  ingestionId?: string | null;
  thingsboardId?: string | null;
}

// Update toDeviceResponse() mapper
```

### 5. Repository Changes

#### `CustomerRepository`

Update `create()` and `update()` to persist `ingestionId` and `thingsboardId`. Add query methods:

```typescript
async findByThingsboardId(tenantId: string, thingsboardId: string): Promise<Customer | null>;
async findByIngestionId(tenantId: string, ingestionId: string): Promise<Customer | null>;
```

#### `AssetRepository`

Same pattern as CustomerRepository:

```typescript
async findByThingsboardId(tenantId: string, thingsboardId: string): Promise<Asset | null>;
async findByIngestionId(tenantId: string, ingestionId: string): Promise<Asset | null>;
```

#### `DeviceRepository`

Add `thingsboardId` to existing `create()` and `update()`. Add:

```typescript
async findByThingsboardId(tenantId: string, thingsboardId: string): Promise<Device | null>;
// findByIngestionId likely already exists from RFC-0008
```

### 6. API Key Scope Extension

#### New Scope: `sync:write`

Add to `src/domain/entities/CustomerApiKey.ts`:

```typescript
export type ApiKeyScope =
  | 'bundles:read'
  | 'devices:read'
  | 'rules:read'
  | 'assets:read'
  | 'groups:read'
  | 'simulator:read'
  | 'simulator:write'
  | 'simulator:admin'
  | 'customers:read'     // NEW
  | 'customers:write'    // NEW
  | 'assets:write'       // NEW
  | 'sync:write'         // NEW: write integration mapping fields
  | '*:read';
```

The `sync:write` scope authorizes writing to integration-specific fields (`ingestionId`, `thingsboardId`) without granting full entity update permissions. Services holding `customers:write` + `sync:write` can update the mapping fields on customers.

### 7. Seed Data Changes

#### 7a. Customer Seeds (`scripts/db/seeds/01-customers.sql`)

Add `ingestion_id` and `thingsboard_id` to existing customer inserts:

```sql
-- ACME Holdings
ingestion_id = 'a1000001-0001-0001-0001-000000000001',
thingsboard_id = 'tb100001-0001-0001-0001-000000000001',

-- ACME Tech (Company)
ingestion_id = 'a1000001-0001-0001-0001-000000000002',
thingsboard_id = 'tb100001-0001-0001-0001-000000000002',

-- Dimension
ingestion_id = 'a1000001-0001-0001-0001-000000000006',
thingsboard_id = 'tb100001-0001-0001-0001-000000000006',
```

#### 7b. Asset Seeds (`scripts/db/seeds/07-assets.sql`)

Add `ingestion_id` and `thingsboard_id` to existing asset inserts:

```sql
-- Headquarters Building
ingestion_id = 'a2000001-0001-0001-0001-000000000001',
thingsboard_id = 'tb200001-0001-0001-0001-000000000001',
```

#### 7c. Device Seeds (`scripts/db/seeds/08-devices.sql`)

Add `thingsboard_id` column to existing device inserts. Migrate existing `external_id` ThingsBoard references to proper UUIDs:

```sql
-- Temperature Sensor 01
thingsboard_id = 'tb300001-0001-0001-0001-000000000001',
```

#### 7d. ThingsBoard Integration API Key (`scripts/db/seeds/13-customer-api-keys.sql`)

Add a new API key specifically for the ThingsBoard connector:

```sql
-- ==========================================================================
-- ThingsBoard Connector API Key
-- ==========================================================================
-- Plaintext Key: gcdr_cust_tb_integration_key_2026
-- Hash: SHA256('gcdr_cust_tb_integration_key_2026')
INSERT INTO customer_api_keys (
    id, tenant_id, customer_id, key_hash, key_prefix,
    name, description, scopes, expires_at,
    usage_count, is_active, created_by, version
) VALUES (
    'cee00001-0001-0001-0001-000000000008',
    v_tenant_id,
    v_company1_id,
    -- SHA256 hash of 'gcdr_cust_tb_integration_key_2026'
    '<computed-hash>',
    'gcdr_cust_',
    'ThingsBoard Connector',
    'API key for ThingsBoard entity sync - TEST KEY: gcdr_cust_tb_integration_key_2026',
    '["customers:read", "customers:write", "assets:read", "assets:write", "devices:read", "devices:write", "sync:write"]',
    NOW() + INTERVAL '365 days',
    0,
    true,
    v_admin_id,
    1
);
```

### 8. JWT Audience Extension

Update the `JWT_AUDIENCE` environment variable to include the ThingsBoard connector:

```env
# Before
JWT_AUDIENCE=gcdr-api,alarm-orchestrator

# After
JWT_AUDIENCE=gcdr-api,alarm-orchestrator,thingsboard-connector
```

This allows the ThingsBoard connector to validate GCDR-issued JWT tokens when receiving webhook callbacks or event notifications from GCDR.

### 9. CORS Configuration

Add `X-Admin-Password` is already in the allowed headers. No additional CORS changes needed -- the ThingsBoard connector communicates server-to-server via API keys, not browser-based requests.

---

## Files to Modify

### Database & Schema

| File | Action |
|------|--------|
| `src/infrastructure/database/drizzle/schema.ts` | Add `ingestionId`, `thingsboardId` columns to `customers` and `assets`; add `thingsboardId` to `devices` |
| New migration file | `ALTER TABLE` statements with indexes |

### Domain Entities

| File | Action |
|------|--------|
| `src/domain/entities/Customer.ts` | Add `ingestionId?`, `thingsboardId?` fields |
| `src/domain/entities/Asset.ts` | Add `ingestionId?`, `thingsboardId?` fields |
| `src/domain/entities/Device.ts` | Add `thingsboardId?` field |
| `src/domain/entities/CustomerApiKey.ts` | Add new scopes: `customers:read`, `customers:write`, `assets:write`, `sync:write` |

### DTOs

| File | Action |
|------|--------|
| `src/dto/request/CustomerDTO.ts` | Add `ingestionId`, `thingsboardId` to create/update schemas |
| `src/dto/request/AssetDTO.ts` | Add `ingestionId`, `thingsboardId` to create/update schemas |
| `src/dto/request/DeviceDTO.ts` | Add `thingsboardId` to create/update schemas |
| `src/dto/response/CustomerResponseDTO.ts` | Add fields + update mapper |
| `src/dto/response/AssetResponseDTO.ts` | Add fields + update mapper |
| `src/dto/response/DeviceResponseDTO.ts` | Add `thingsboardId` field + update mapper |

### Repositories

| File | Action |
|------|--------|
| `src/repositories/CustomerRepository.ts` | Persist new fields; add `findByThingsboardId`, `findByIngestionId` |
| `src/repositories/AssetRepository.ts` | Persist new fields; add `findByThingsboardId`, `findByIngestionId` |
| `src/repositories/DeviceRepository.ts` | Persist `thingsboardId`; add `findByThingsboardId` |

### Seeds

| File | Action |
|------|--------|
| `scripts/db/seeds/01-customers.sql` | Add `ingestion_id`, `thingsboard_id` values |
| `scripts/db/seeds/07-assets.sql` | Add `ingestion_id`, `thingsboard_id` values |
| `scripts/db/seeds/08-devices.sql` | Add `thingsboard_id` values |
| `scripts/db/seeds/13-customer-api-keys.sql` | Add ThingsBoard connector API key |

### Configuration

| File | Action |
|------|--------|
| `.env.example` / deployment docs | Update `JWT_AUDIENCE` to include `thingsboard-connector` |
| `src/middleware/auth.ts` | No code changes needed (audience is env-driven per RFC-0003) |

### Documentation

| File | Action |
|------|--------|
| `docs/rfcs/RFC-0016-ThingsBoard-Entity-Mapping.md` | This document |
| Swagger/OpenAPI docs | Update entity schemas to include new fields |

---

## Migration Strategy

### Phase 1: Schema + Seeds (Non-breaking)

1. Run `ALTER TABLE` migration to add nullable columns.
2. Update seed files with sample ThingsBoard/ingestion UUIDs.
3. Update domain entities, DTOs, and repositories.
4. Deploy -- all new fields default to `null`, existing functionality is unaffected.

### Phase 2: ThingsBoard Connector Integration

1. Deploy the ThingsBoard connector service with the new API key.
2. Connector starts populating `thingsboardId` on entities as they are synced.
3. Backfill existing devices: migrate valid ThingsBoard UUIDs from `externalId` to `thingsboardId`.

### Phase 3: Deprecate `externalId` for ThingsBoard (Future)

1. Once all ThingsBoard references are in `thingsboardId`, `externalId` can be repurposed for other external systems or deprecated.
2. This is a future RFC concern -- no action needed in this phase.

---

## Drawbacks

1. **Schema churn** -- Adding 5 new columns across 3 tables. However, all are nullable UUIDs with partial indexes, so storage/performance impact is minimal.

2. **`externalId` ambiguity persists** -- We are not removing or renaming `externalId` on devices. This creates a period where ThingsBoard IDs may exist in both `externalId` and `thingsboardId`. Mitigation: a one-time backfill script in Phase 2.

3. **New scopes** -- Adding `customers:write`, `assets:write`, and `sync:write` scopes expands the authorization surface. Mitigation: `sync:write` is narrowly scoped to integration fields only.

---

## Alternatives Considered

### A. Store IDs in `metadata` JSONB

```json
{ "metadata": { "thingsboardId": "uuid", "ingestionId": "uuid" } }
```

**Rejected:** JSONB fields are not indexable for equality lookups without GIN indexes, which are expensive. Direct UUID columns with partial B-tree indexes are significantly faster for the reverse-lookup use case.

### B. Generic `external_references` table

A separate table mapping `(entity_type, entity_id, system_name, external_id)`.

**Rejected:** Adds a JOIN to every entity query that needs integration IDs. The two-column approach (ingestionId + thingsboardId) is simpler, faster, and sufficient for the known integration targets.

### C. Extend `externalId` to Customer/Asset

Reuse the existing `externalId` varchar pattern from devices.

**Rejected:** `externalId` is a varchar without UUID validation or system-specific semantics. A typed UUID column per system is safer and enables proper foreign-key-style lookups.

---

## Unresolved Questions

1. **Should `sync:write` be a standalone scope or combined with entity write scopes?**
   Current proposal: standalone scope so that an integration can update mapping fields without full entity write access. Open for discussion.

2. **Should `thingsboardId` have a UNIQUE constraint per tenant?**
   A given ThingsBoard entity should map to at most one GCDR entity within a tenant. A unique partial index (`UNIQUE (tenant_id, thingsboard_id) WHERE thingsboard_id IS NOT NULL`) would enforce this. Recommended but flagged for discussion.

3. **Backfill strategy for existing `externalId` values on devices.**
   Some seed values are labels (`tb-device-temp-001`), not UUIDs. These cannot be migrated automatically. Manual mapping or a lookup table may be needed.

---

## Future Possibilities

- **Webhook on mapping change:** Emit an event when `thingsboardId` is set/updated, enabling reactive sync pipelines.
- **Bidirectional sync status field:** `syncStatus: 'SYNCED' | 'PENDING' | 'ERROR'` per entity to track sync health.
- **Integration dashboard:** A new admin UI tab showing sync status across all entities and systems.
