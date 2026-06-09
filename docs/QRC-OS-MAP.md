# QR Checker (`qrc`) / OS — Domain Map

> **What it is.** `qrc` = **QR Checker** (RFC-0032), surfaced in the UI as **"OS"
> (Ordens de Serviço / Service Orders)** under the `/os` route. It is the field
> work domain: a technician scans the QR sticker on equipment, registers
> **installations** on devices, opens **maintenance tasks**, and records
> **technical visits** (visitas) with ambientes, products, photos and reports.
>
> Migrated from a standalone app (`qrcode-check.git`, Next.js + SQLite) into GCDR.
> The `qrc_*` prefix marks tables that live only in this domain; it reuses the
> existing `customers`, `users`, `devices` and `file_assets` tables.
>
> **Naming:** `qrc` = technical/backend name · **OS** = product/UI name. Same module.

---

## 1. Data model

### 1.1 Entity-relationship overview

```
                         customers ──1:1── qrc_customer_settings   (opt-in: customer is "OS-enabled")
                             │                  · viewer_password_hash, default_central_id, qrc_metadata
                             ├──1:N── qrc_customer_observations
                             │
   ┌─────────────────────────┴───────────────────────────┐
   │ INSTALLATIONS (per device)         VISITAS (surveys)  │
   ▼                                                       ▼
 devices ──1:1── qrc_installations              qrc_visitas_tecnicas
                    │  (UNIQUE tenant+device)        │  (status: pending/in_progress/done)
                    ├──1:N── qrc_installation_images ├──1:N── qrc_visita_observations
                    ├──1:N── qrc_installation_audit  ├──1:N── qrc_visita_audit
                    └──1:N── qrc_maintenance_tasks   └──1:N── qrc_visita_ambientes
                                                               ├──1:N── qrc_visita_ambiente_images
                                                               └──1:N── qrc_visita_products
                                                                          └──1:N── qrc_visita_product_images

 file_assets  ◄── referenced (loose) by every *_images table + observation.fileAssetId
 users        ◄── installed_by / created_by / changed_by / completed_by (no FK)
```

### 1.2 Tables (13) — defined in `src/infrastructure/database/drizzle/schema.ts:1647–1873`

**Opt-in / customer scope**

| Table | Key columns | Constraints / notes |
|---|---|---|
| `qrc_customer_settings` | PK `customer_id`→customers, `tenant_id`, `viewer_password_hash`, `default_central_id`, `qrc_metadata jsonb`, `created_by` | Marks a customer as OS-enabled. 1 row per customer. |
| `qrc_customer_observations` | `customer_id`→customers, `observation`, `file_asset_id?`, `created_by` | Customer-level notes (distinct from installation obs). |

**Installations**

| Table | Key columns | Constraints / notes |
|---|---|---|
| `qrc_installations` | `device_id`→devices (restrict), `customer_id`→customers (restrict), `position`, `tc_type?`, `impedimento_text`, `obs?`, `current_multiplier?`, `voltage_multiplier?`, `installed_by`, `deleted_at?` | **UNIQUE(tenant_id, device_id)** · status ∈ `instalado/impedimento/removido/defeito` (col `impedimento_text`, default `instalado`) · `tc_type` ∈ `50A/100A/400A/1000A/2000A` or NULL |
| `qrc_installation_images` | `installation_id`→cascade, `file_asset_id`, `image_order`, `caption?` | UNIQUE(installation, file_asset) · `image_order` 0..19 |
| `qrc_installation_audit` | `installation_id`→cascade, `revision`, `change_type`, `old_value/new_value jsonb`, `changed_by` | UNIQUE(installation, revision) · `change_type` ∈ `created/updated/deleted/image_added/image_removed/task_created/task_completed` |
| `qrc_maintenance_tasks` | `installation_id`→cascade, `description`, `status`, `created_by`, `completed_by/at/notes?`, `reviewed_by/at?` | status ∈ `pending/pending_review/resolved/removido` (default `pending`) |

**Visitas técnicas**

| Table | Key columns | Constraints / notes |
|---|---|---|
| `qrc_visitas_tecnicas` | `customer_id?`→set null, `name`, `observation?`, `status`, `created_by`, `deleted_at?` | status ∈ `pending/in_progress/done` (default `pending`) |
| `qrc_visita_ambientes` | `visita_id`→cascade, `name`, `observation?`, `ac_quantity?`, `product_quantity?`, `product_type?`, `created_by` | |
| `qrc_visita_ambiente_images` | `ambiente_id`→cascade, `file_asset_id`, `image_order`, `caption?` | `image_order` 0..49 (DTO) |
| `qrc_visita_products` | `ambiente_id`→cascade, `product_type`, `description?`, `quantity`, `created_by` | CHECK `quantity > 0` (default 1) |
| `qrc_visita_product_images` | `product_id`→cascade, `file_asset_id`, `image_order` | `image_order` 0..4 (DTO) |
| `qrc_visita_observations` | `visita_id`→cascade, `observation`, `file_asset_id?`, `created_by` | |
| `qrc_visita_audit` | `visita_id`→cascade, `ambiente_id?`, `revision`, `change_type`, `old/new_value jsonb`, `changed_by` | no change_type CHECK |

**Device addressing (on the `devices` table, not `qrc_*`)** — populated from the scanned QR:
`qrc_addr_low`, `qrc_addr_high`, `qrc_identifier` · partial index `idx_devices_qrc_addr (tenant, qrc_addr_low, qrc_addr_high)`.

### 1.3 Migrations
- `drizzle/migrations/0024_qrchecker_schema.sql` — creates all `qrc_*` tables.
- `drizzle/migrations/0026_rename_qrc_to_wo.sql` — adjusts the device addressing columns.

---

## 2. Backend code map

Mirrored, one-per-entity structure under a `qrc/` subfolder in each layer.

| Layer | Path | Files |
|---|---|---|
| Entities | `src/domain/entities/qrc/` | CustomerSettings, CustomerObservation, Installation, InstallationImage, InstallationAudit, MaintenanceTask, Visita, VisitaAmbiente, VisitaAmbienteImage, VisitaProduct, VisitaProductImage, VisitaObservation, VisitaAudit |
| DTOs (Zod) | `src/dto/request/qrc/` | CustomerSettingsDTO, CustomerObservationDTO, InstallationDTO, MaintenanceTaskDTO, VisitaDTO · plus `src/dto/request/auth/OperatorPinSchema.ts` |
| Repositories | `src/repositories/qrc/` (+ `interfaces/qrc/`) | one per entity |
| Services | `src/services/qrc/` | `QrcCustomerSettingsService` (enable/disable/settings), `InstallationService` (upsert-by-QR, images, audit), `MaintenanceTaskService`, `VisitaService` (ambientes/products/obs), `CustomerObservationService`, `QrcPinService` (field-operator PIN auth), `QrcReportService` (reports) |
| Controllers | `src/controllers/qrc/` | qrc-installations, qrc-visitas, qrc-users, qrc-customers |

Route mounting — `src/app.ts:325–332`.

---

## 3. API reference (`/api/v1`)

All bodies validated with the Zod DTOs above. Most routes require JWT
(`authMiddleware`); the two **public** exceptions are noted.

### 3.1 Installations — router `/qrc` (`qrc-installations.controller.ts`)

| Method · Path | Body | Notes |
|---|---|---|
| `POST /qrc/install` | `{ customerId, deviceId, ... }` **OR** `{ customerId, addrLow, addrHigh, ... }` + `position, tcType?, obs?, currentMultiplier?, voltageMultiplier?, status? } ` | **Upsert** installation. Accepts a deviceId OR an (addrLow,addrHigh 0..255) pair; server resolves to one device. |
| `GET /qrc/installations/:id` | — | |
| `PATCH /qrc/installations/:id` | partial of install common fields | |
| `GET /qrc/installations/:id/audit` | — | revision history |
| `GET /qrc/installations/:id/images` | — | |
| `POST /qrc/installations/:id/images` | `{ fileAssetId, imageOrder? 0..19, caption? }` (multipart upload supported) | |
| `PATCH /qrc/installations/:installationId/images/:imageId` | `{ imageOrder?, caption? }` | |
| `DELETE /qrc/installations/:installationId/images/:imageId` | — | |
| `GET /qrc/installations/:id/tasks` | — | |
| `POST /qrc/installations/:id/tasks` | `{ description }` | |
| `PATCH /qrc/installations/:installationId/tasks/:taskId` | `{ status?, description?, completedNotes? }` | status ∈ pending/pending_review/resolved/removido |

### 3.2 Visitas — router `/qrc/visitas` (`qrc-visitas.controller.ts`)

| Method · Path | Body | Notes |
|---|---|---|
| `GET /qrc/visitas` | — | list |
| `POST /qrc/visitas` | `{ customerId?, name, observation? }` | |
| `GET/PATCH/DELETE /qrc/visitas/:id` | PATCH: `{ customerId?, name?, observation?, status? }` | status ∈ pending/in_progress/done |
| `GET /qrc/visitas/:id/audit` | — | |
| `GET /qrc/visitas/:id/report` | — | generated report |
| `GET/POST /qrc/visitas/:id/observations` · `DELETE .../:observationId` | `{ observation, fileAssetId? }` | |
| `GET/POST /qrc/visitas/:id/ambientes` · `GET/PATCH/DELETE .../:ambienteId` | `{ name, observation?, acQuantity?, productQuantity?, productType? }` | |
| `GET/POST .../ambientes/:ambienteId/images` · `PATCH/DELETE .../images/:imageId` | `{ fileAssetId, imageOrder? 0..49, caption? }` | |
| `GET/POST .../ambientes/:ambienteId/products` · `PATCH/DELETE .../products/:productId` | `{ productType, description?, quantity≥1 }` | |
| `GET/POST .../products/:productId/images` · `DELETE .../images/:imageId` | `{ fileAssetId, imageOrder? 0..4 }` | |

### 3.3 Users (field operators) — router `/qrc/users` (`qrc-users.controller.ts`)

| Method · Path | Body | Notes |
|---|---|---|
| `PATCH /qrc/users/:userId/pin` | `{ pin: "1234" }` (set) or `{ pin: null }` (clear) | admin sets a 4-digit operator PIN |
| `GET /qrc/users/:userId/audit` | — | operator activity |

### 3.4 Customers (OS scope) — router `/qrc/customers` (`qrc-customers.controller.ts`)

| Method · Path | Body | Notes |
|---|---|---|
| `GET /qrc/customers` | — | OS-enabled customers |
| `GET /qrc/customers/by-code/:code` | — | |
| `POST /qrc/customers/:customerId/enable` | `{ defaultCentralId?, viewerPassword?, qrcMetadata? }` | enable OS |
| `PATCH /qrc/customers/:customerId/settings` | same shape | |
| `POST /qrc/customers/:customerId/disable` | — | |
| **`POST /qrc/customers/:customerId/viewer-login`** | `{ password }` | **PUBLIC** (no auth) — viewer-password gate |
| `GET /qrc/customers/:customerId/devices` | — | devices + install status |
| `GET/POST /qrc/customers/:customerId/observations` · `DELETE .../:observationId` | `{ observation, fileAssetId? }` | |
| `GET /qrc/customers/:customerId/report` | — | customer OS report |

### 3.5 Operator PIN login — `auth` router (not under `/qrc`)

| Method · Path | Body | Notes |
|---|---|---|
| **`POST /api/v1/auth/operator-pin`** | `{ pin: "1234", tenantId }` | **PUBLIC** — field operator logs in with a 4-digit PIN (see `QrcPinService` + `OperatorPinSchema`). |

---

## 4. Frontend (module "OS") — `gcdr-frontend.git`

| Concern | Path |
|---|---|
| Routes | `src/router/index.tsx` → `/os`, `/os/customers/:id`, `/os/visitas/:id` |
| Pages | `src/pages/os/` → `OsLanding`, `OsCustomerDetail`, `OsVisitaDetail`, `CustomerMultiSelect` |
| API client | `src/services/api/qrcService.ts` |
| State/hooks | `src/hooks/useQrc.ts` |
| Types | `src/types/qrc.ts` |
| i18n | `src/i18n/locales/{en,pt-BR}/os.json` |

---

## 5. Demo data

`scripts/db/ops/mestre-alvaro-os-demo-load.sql` — idempotent demo load for the
Mestre Álvaro customer (enables OS, creates installations on existing devices,
maintenance tasks, a technical visit with ambientes/products/observations). All
demo rows are prefixed `[DEMO]`.
