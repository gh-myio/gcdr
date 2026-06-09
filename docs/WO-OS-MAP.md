# Work Orders (`wo`) / OS — Domain Map

> **What it is.** `wo` = **Work Orders** (backend domain; formerly "QR Checker",
> RFC-0032), surfaced in the UI as **"OS"
> (Ordens de Serviço / Service Orders)** under the `/os` route. It is the field
> work domain: a technician scans the QR sticker on equipment, registers
> **installations** on devices, opens **maintenance tasks**, and records
> **technical visits** (visitas) with ambientes, products, photos and reports.
>
> Migrated from a standalone app (`qrcode-check.git`, Next.js + SQLite) into GCDR.
> The `wo_*` prefix marks tables that live only in this domain; it reuses the
> existing `customers`, `users`, `devices` and `file_assets` tables.
>
> **Naming:** `wo` (Work Orders) = technical/backend name · **OS** = product/UI name. Same module. (The backend domain was renamed `qrc`→`wo`.)

---

## 1. Data model

### 1.1 Entity-relationship overview

```
                         customers ──1:1── wo_customer_settings   (opt-in: customer is "OS-enabled")
                             │                  · viewer_password_hash, default_central_id, wo_metadata
                             ├──1:N── wo_customer_observations
                             │
   ┌─────────────────────────┴───────────────────────────┐
   │ INSTALLATIONS (per device)         VISITAS (surveys)  │
   ▼                                                       ▼
 devices ──1:1── wo_installations              wo_visitas_tecnicas
                    │  (UNIQUE tenant+device)        │  (status: pending/in_progress/done)
                    ├──1:N── wo_installation_images ├──1:N── wo_visita_observations
                    ├──1:N── wo_installation_audit  ├──1:N── wo_visita_audit
                    └──1:N── wo_maintenance_tasks   └──1:N── wo_visita_ambientes
                                                               ├──1:N── wo_visita_ambiente_images
                                                               └──1:N── wo_visita_products
                                                                          └──1:N── wo_visita_product_images

 file_assets  ◄── referenced (loose) by every *_images table + observation.fileAssetId
 users        ◄── installed_by / created_by / changed_by / completed_by (no FK)
```

### 1.2 Tables (13) — defined in `src/infrastructure/database/drizzle/schema.ts:1647–1873`

**Opt-in / customer scope**

| Table | Key columns | Constraints / notes |
|---|---|---|
| `wo_customer_settings` | PK `customer_id`→customers, `tenant_id`, `viewer_password_hash`, `default_central_id`, `wo_metadata jsonb`, `created_by` | Marks a customer as OS-enabled. 1 row per customer. |
| `wo_customer_observations` | `customer_id`→customers, `observation`, `file_asset_id?`, `created_by` | Customer-level notes (distinct from installation obs). |

**Installations**

| Table | Key columns | Constraints / notes |
|---|---|---|
| `wo_installations` | `device_id`→devices (restrict), `customer_id`→customers (restrict), `position`, `tc_type?`, `impedimento_text`, `obs?`, `current_multiplier?`, `voltage_multiplier?`, `installed_by`, `deleted_at?` | **UNIQUE(tenant_id, device_id)** · status ∈ `instalado/impedimento/removido/defeito` (col `impedimento_text`, default `instalado`) · `tc_type` ∈ `50A/100A/400A/1000A/2000A` or NULL |
| `wo_installation_images` | `installation_id`→cascade, `file_asset_id`, `image_order`, `caption?` | UNIQUE(installation, file_asset) · `image_order` 0..19 |
| `wo_installation_audit` | `installation_id`→cascade, `revision`, `change_type`, `old_value/new_value jsonb`, `changed_by` | UNIQUE(installation, revision) · `change_type` ∈ `created/updated/deleted/image_added/image_removed/task_created/task_completed` |
| `wo_maintenance_tasks` | `installation_id`→cascade, `description`, `status`, `created_by`, `completed_by/at/notes?`, `reviewed_by/at?` | status ∈ `pending/pending_review/resolved/removido` (default `pending`) |

**Visitas técnicas**

| Table | Key columns | Constraints / notes |
|---|---|---|
| `wo_visitas_tecnicas` | `customer_id?`→set null, `name`, `observation?`, `status`, `created_by`, `deleted_at?` | status ∈ `pending/in_progress/done` (default `pending`) |
| `wo_visita_ambientes` | `visita_id`→cascade, `name`, `observation?`, `ac_quantity?`, `product_quantity?`, `product_type?`, `created_by` | |
| `wo_visita_ambiente_images` | `ambiente_id`→cascade, `file_asset_id`, `image_order`, `caption?` | `image_order` 0..49 (DTO) |
| `wo_visita_products` | `ambiente_id`→cascade, `product_type`, `description?`, `quantity`, `created_by` | CHECK `quantity > 0` (default 1) |
| `wo_visita_product_images` | `product_id`→cascade, `file_asset_id`, `image_order` | `image_order` 0..4 (DTO) |
| `wo_visita_observations` | `visita_id`→cascade, `observation`, `file_asset_id?`, `created_by` | |
| `wo_visita_audit` | `visita_id`→cascade, `ambiente_id?`, `revision`, `change_type`, `old/new_value jsonb`, `changed_by` | no change_type CHECK |

**Device addressing (on the `devices` table, not `wo_*`)** — populated from the scanned QR:
`wo_addr_low`, `wo_addr_high`, `wo_identifier` · partial index `idx_devices_wo_addr (tenant, wo_addr_low, wo_addr_high)`.

### 1.3 Migrations
- `drizzle/migrations/0024_qrchecker_schema.sql` — creates all the original `qrc_*` tables.
- `drizzle/migrations/0026_rename_qrc_to_wo.sql` — renames everything `qrc`→`wo` (tables, columns, indexes) and adjusts the device addressing columns.

---

## 2. Backend code map

Mirrored, one-per-entity structure under a `wo/` subfolder in each layer.

| Layer | Path | Files |
|---|---|---|
| Entities | `src/domain/entities/wo/` | CustomerSettings, CustomerObservation, Installation, InstallationImage, InstallationAudit, MaintenanceTask, Visita, VisitaAmbiente, VisitaAmbienteImage, VisitaProduct, VisitaProductImage, VisitaObservation, VisitaAudit |
| DTOs (Zod) | `src/dto/request/wo/` | CustomerSettingsDTO, CustomerObservationDTO, InstallationDTO, MaintenanceTaskDTO, VisitaDTO · plus `src/dto/request/auth/OperatorPinSchema.ts` |
| Repositories | `src/repositories/wo/` (+ `interfaces/wo/`) | one per entity |
| Services | `src/services/wo/` | `WoCustomerSettingsService` (enable/disable/settings), `InstallationService` (upsert-by-QR, images, audit), `MaintenanceTaskService`, `VisitaService` (ambientes/products/obs), `CustomerObservationService`, `WoPinService` (field-operator PIN auth), `WoReportService` (reports) |
| Controllers | `src/controllers/wo/` | wo-installations, wo-visitas, wo-users, wo-customers |

Route mounting — `src/app.ts:325–332`.

---

## 3. API reference (`/api/v1`)

All bodies validated with the Zod DTOs above. Most routes require JWT
(`authMiddleware`); the two **public** exceptions are noted.

### 3.1 Installations — router `/wo` (`wo-installations.controller.ts`)

| Method · Path | Body | Notes |
|---|---|---|
| `POST /wo/install` | `{ customerId, deviceId, ... }` **OR** `{ customerId, addrLow, addrHigh, ... }` + `position, tcType?, obs?, currentMultiplier?, voltageMultiplier?, status? } ` | **Upsert** installation. Accepts a deviceId OR an (addrLow,addrHigh 0..255) pair; server resolves to one device. |
| `GET /wo/installations/:id` | — | |
| `PATCH /wo/installations/:id` | partial of install common fields | |
| `GET /wo/installations/:id/audit` | — | revision history |
| `GET /wo/installations/:id/images` | — | |
| `POST /wo/installations/:id/images` | `{ fileAssetId, imageOrder? 0..19, caption? }` (multipart upload supported) | |
| `PATCH /wo/installations/:installationId/images/:imageId` | `{ imageOrder?, caption? }` | |
| `DELETE /wo/installations/:installationId/images/:imageId` | — | |
| `GET /wo/installations/:id/tasks` | — | |
| `POST /wo/installations/:id/tasks` | `{ description }` | |
| `PATCH /wo/installations/:installationId/tasks/:taskId` | `{ status?, description?, completedNotes? }` | status ∈ pending/pending_review/resolved/removido |

### 3.2 Visitas — router `/wo/visitas` (`wo-visitas.controller.ts`)

| Method · Path | Body | Notes |
|---|---|---|
| `GET /wo/visitas` | — | list |
| `POST /wo/visitas` | `{ customerId?, name, observation? }` | |
| `GET/PATCH/DELETE /wo/visitas/:id` | PATCH: `{ customerId?, name?, observation?, status? }` | status ∈ pending/in_progress/done |
| `GET /wo/visitas/:id/audit` | — | |
| `GET /wo/visitas/:id/report` | — | generated report |
| `GET/POST /wo/visitas/:id/observations` · `DELETE .../:observationId` | `{ observation, fileAssetId? }` | |
| `GET/POST /wo/visitas/:id/ambientes` · `GET/PATCH/DELETE .../:ambienteId` | `{ name, observation?, acQuantity?, productQuantity?, productType? }` | |
| `GET/POST .../ambientes/:ambienteId/images` · `PATCH/DELETE .../images/:imageId` | `{ fileAssetId, imageOrder? 0..49, caption? }` | |
| `GET/POST .../ambientes/:ambienteId/products` · `PATCH/DELETE .../products/:productId` | `{ productType, description?, quantity≥1 }` | |
| `GET/POST .../products/:productId/images` · `DELETE .../images/:imageId` | `{ fileAssetId, imageOrder? 0..4 }` | |

### 3.3 Users (field operators) — router `/wo/users` (`wo-users.controller.ts`)

| Method · Path | Body | Notes |
|---|---|---|
| `PATCH /wo/users/:userId/pin` | `{ pin: "1234" }` (set) or `{ pin: null }` (clear) | admin sets a 4-digit operator PIN |
| `GET /wo/users/:userId/audit` | — | operator activity |

### 3.4 Customers (OS scope) — router `/wo/customers` (`wo-customers.controller.ts`)

| Method · Path | Body | Notes |
|---|---|---|
| `GET /wo/customers` | — | OS-enabled customers |
| `GET /wo/customers/by-code/:code` | — | |
| `POST /wo/customers/:customerId/enable` | `{ defaultCentralId?, viewerPassword?, woMetadata? }` | enable OS |
| `PATCH /wo/customers/:customerId/settings` | same shape | |
| `POST /wo/customers/:customerId/disable` | — | |
| **`POST /wo/customers/:customerId/viewer-login`** | `{ password }` | **PUBLIC** (no auth) — viewer-password gate |
| `GET /wo/customers/:customerId/devices` | — | devices + install status |
| `GET/POST /wo/customers/:customerId/observations` · `DELETE .../:observationId` | `{ observation, fileAssetId? }` | |
| `GET /wo/customers/:customerId/report` | — | customer OS report |

### 3.5 Operator PIN login — `auth` router (not under `/wo`)

| Method · Path | Body | Notes |
|---|---|---|
| **`POST /api/v1/auth/operator-pin`** | `{ pin: "1234", tenantId }` | **PUBLIC** — field operator logs in with a 4-digit PIN (see `WoPinService` + `OperatorPinSchema`). |

---

## 4. Frontend (module "OS") — `gcdr-frontend.git`

| Concern | Path |
|---|---|
| Routes | `src/router/index.tsx` → `/os`, `/os/customers/:id`, `/os/visitas/:id` |
| Pages | `src/pages/os/` → `OsLanding`, `OsCustomerDetail`, `OsVisitaDetail`, `CustomerMultiSelect` |
| API client | `src/services/api/woService.ts` |
| State/hooks | `src/hooks/useWo.ts` |
| Types | `src/types/wo.ts` |
| i18n | `src/i18n/locales/{en,pt-BR}/os.json` |

---

## 5. Demo data

`scripts/db/ops/mestre-alvaro-os-demo-load.sql` — idempotent demo load for the
Mestre Álvaro customer (enables OS, creates installations on existing devices,
maintenance tasks, a technical visit with ambientes/products/observations). All
demo rows are prefixed `[DEMO]`.
