# Device — Field Catalog

> **What a Device record stores in GCDR.** This catalogs every column of the
> `devices` table, its type, nullability, and meaning. It is the reference for
> "does a device keep X?" questions.
>
> **Source of truth:** `src/infrastructure/database/drizzle/schema.ts`
> (`devices = pgTable(...)`, lines ~381–509). If this doc and the schema
> disagree, the schema wins — update this doc.
>
> **Last synced:** 2026-08-17 (against `desenv`).
>
> **Scope — current schema only.** This catalog lists fields that **exist today**
> in `schema.ts`. Fields that are only *proposed* in an RFC are **not** listed
> here until the migration lands. In particular, `box_id` (self-referential BOX
> membership) is proposed in **RFC-0058** and is **not yet in the schema** — do
> not treat it as a current device field.

---

## Quick answers

| Question | Stored? | Field(s) |
|---|---|---|
| Product code | ⚠️ no single `productCode` field | `code`, `deviceType`, `deviceProfile`, `identifier`, `serialNumber` (pick per meaning) |
| Address low / high | ✅ yes | `woAddrLow` / `woAddrHigh` (from the QR sticker, RFC-0032) |
| Central id | ✅ yes | `centralId` (FK → `centrals`) |
| Frequency | ❌ not on the device | `frequency` lives on the **central** (it is the *radio channel*, 1–255). The device's read cadence is `telemetryConfig.reportingInterval` (jsonb) |
| Modbus slave id | ✅ yes | `slaveId` (1–999) |
| Serial number | ✅ yes | `serialNumber` (unique per tenant) |

**Two independent addressing systems** live on a device — do not conflate them:

1. **Modbus / RFC-0008** — the device's address *on its central*:
   `centralId` + `slaveId` + `channel` + `deviceChannelType`.
2. **QR / RFC-0032** — decoded from the physical sticker by the field app:
   `woAddrLow` + `woAddrHigh` + `woIdentifier`. Populated on `POST /api/v1/wo/install`
   when the client scans a QR and passes `addr_low`/`addr_high` instead of a device id.

---

## Fields

### Keys & hierarchy

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid (PK) | no | `defaultRandom()` |
| `tenantId` | uuid | no | multi-tenant isolation; part of nearly every index |
| `customerId` | uuid (FK → customers) | no | owning customer |
| `assetId` | uuid (FK → assets) | no | asset the device belongs to |
| `centralId` | uuid (FK → centrals) | yes | RFC-0008 — the central the device is wired to |

### Basic info

| Column | Type | Null | Notes |
|---|---|---|---|
| `name` | varchar(255) | no | unique per `(tenant, customer)` |
| `displayName` | varchar(255) | no | UI label |
| `code` | varchar(50) | yes | short code |
| `label` | varchar(255) | yes | free label (widened to 255 in migration 0046) |
| `type` | enum `device_type` | no | see enums |
| `description` | text | yes | |

### Identification

| Column | Type | Null | Notes |
|---|---|---|---|
| `serialNumber` | varchar(100) | no | **unique per tenant** (`devices_tenant_serial_unique`) |
| `externalId` | varchar(255) | yes | id in an external system (e.g. ThingsBoard) |
| `identifier` | varchar(255) | yes | human-readable Modbus register name (e.g. `CAG`, `TEMPERATURA`); **repeats** across devices — not unique |
| `deviceProfile` | varchar(100) | yes | profile (e.g. `HIDROMETRO_AREA_COMUM`) |
| `deviceType` | varchar(100) | yes | specific type string (e.g. `3F_MEDIDOR`) — distinct from the `type` enum |

### Modbus / channel addressing (RFC-0008, RFC-0008 follow-up 0029)

| Column | Type | Null | Notes |
|---|---|---|---|
| `slaveId` | smallint | yes | Modbus slave id; check `1 ≤ slaveId ≤ 999` |
| `channel` | smallint | yes | channel index on the board; check `0 ≤ channel ≤ 999` |
| `deviceChannelType` | varchar(100) | yes | e.g. `lamp`, `presence_sensor` |

### QR / Work-Order addressing (RFC-0032)

| Column | Type | Null | Notes |
|---|---|---|---|
| `woAddrLow` | smallint | yes | low address from the QR payload |
| `woAddrHigh` | smallint | yes | high address from the QR payload |
| `woIdentifier` | text | yes | identifier from the QR payload |

### Metering & tariff

| Column | Type | Null | Notes |
|---|---|---|---|
| `meterRole` | text | yes | `ENTRY` \| `SUBMETER` (RFC-0046 Addendum A, 0061). ENTRY meters join the goals residual allocation. Both-or-neither with `meterDomain` |
| `meterDomain` | text | yes | `ENERGY` \| `WATER` — the domain the role applies to |
| `tariffCategory` | text | yes | `COMMON_AREA` \| `SPECIFIC` (RFC-0054, 0062). Join key to the hourly tariff; NULL = excluded from the money overlay |

### Ingestion integration

| Column | Type | Null | Notes |
|---|---|---|---|
| `ingestionId` | uuid | yes | id in the ingestion system |
| `ingestionGatewayId` | uuid | yes | gateway id in the ingestion system |

### Connectivity & activity

| Column | Type | Null | Notes |
|---|---|---|---|
| `connectivityStatus` | enum `connectivity_status` | no | default `UNKNOWN` |
| `lastConnectedAt` | timestamptz | yes | |
| `lastDisconnectedAt` | timestamptz | yes | |
| `lastActivityTime` | timestamptz | yes | last telemetry received |
| `lastAlarmTime` | timestamptz | yes | last alarm triggered |

### Config (jsonb — shape not enforced by the schema)

| Column | Type | Default | Typical content |
|---|---|---|---|
| `specs` | jsonb | `{}` | free-form specs (e.g. `{ serialNumber }`) |
| `credentials` | jsonb | null | telemetry/ingestion auth material |
| `telemetryConfig` | jsonb | null | observed shape: `{ attributeKeys: [], telemetryKeys: [], reportingInterval: 60 }` — **`reportingInterval` is the device read cadence** |
| `tags` | jsonb (string[]) | `[]` | |
| `metadata` | jsonb | `{}` | free-form (e.g. TB sync: `tbId`, `syncedAt`) |
| `attributes` | jsonb | `{}` | free-form key/value attributes |

### Status & audit

| Column | Type | Null | Notes |
|---|---|---|---|
| `status` | enum `entity_status` | no | default `ACTIVE` |
| `deletedAt` | timestamptz | yes | soft-delete marker |
| `createdAt` | timestamptz | no | `defaultNow()` |
| `updatedAt` | timestamptz | no | `defaultNow()` |
| `createdBy` | uuid | yes | |
| `updatedBy` | uuid | yes | |
| `version` | integer | no | default 1 (optimistic locking) |

---

## Enums

- **`device_type`** (`type`): `SENSOR`, `ACTUATOR`, `GATEWAY`, `CONTROLLER`, `METER`, `CAMERA`, `OUTLET`, `INFRARED`, `OTHER`
- **`connectivity_status`** (`connectivityStatus`): `ONLINE`, `OFFLINE`, `UNKNOWN`
- **`entity_status`** (`status`): `ACTIVE`, `INACTIVE`, `DELETED`

---

## Indexes & constraints

**Unique**
- `devices_tenant_serial_unique` — `(tenantId, serialNumber)`
- `devices_tenant_customer_name_unique` — `(tenantId, customerId, name)`
- `devices_tenant_central_slave_channel_unique` — `(tenantId, centralId, slaveId, channel, deviceChannelType)`, partial `WHERE centralId IS NOT NULL AND slaveId IS NOT NULL`, `NULLS NOT DISTINCT` (migration 0030). Channel-centric identity.

**Check**
- `valid_slave_id` — `slaveId IS NULL OR 1 ≤ slaveId ≤ 999`
- `devices_channel_range_check` — `channel IS NULL OR 0 ≤ channel ≤ 999`

**Secondary indexes** (all tenant-scoped): `assetId`, `customerId`, `externalId`,
`slaveId`, `centralId`, `identifier`, `deviceProfile`, `deviceType`, `ingestionId`,
`ingestionGatewayId`, `lastActivityTime`, `lastAlarmTime`, and
`idx_devices_wo_addr` on `(tenantId, woAddrLow, woAddrHigh)` (RFC-0032).

**Removed:** `tenantIdentifierUnique` — `identifier` is a Modbus register name
that legitimately repeats across devices (see `fix-identifier-unique-constraint.sql`).

---

## What a device does NOT store (common misconceptions)

- **`frequency`** — not a device column. `frequency` is on the **central** and is
  the *radio channel* (1–255), not a time cadence. A device's read cadence is
  `telemetryConfig.reportingInterval`.
- **`productCode`** — no dedicated field. Depending on what "product" means, use
  `code`, `deviceType`, `deviceProfile`, or `serialNumber`.
- **Consumption / telemetry values** — not stored on the device row. Telemetry
  lives in ThingsBoard / the ingestion system; the device only keeps pointers
  (`externalId`, `ingestionId`, `ingestionGatewayId`) and `lastActivityTime`.

---

## Related RFCs

- **RFC-0008** — Device Attributes Extension (`slaveId`, `centralId`, ingestion ids, activity monitoring); follow-up migration 0029 added `channel` / `deviceChannelType`.
- **RFC-0032** — QR Checker addressing (`woAddrLow`, `woAddrHigh`, `woIdentifier`).
- **RFC-0046 Addendum A** — `meterRole` / `meterDomain` (migration 0061).
- **RFC-0054** — `tariffCategory` (migration 0062).
