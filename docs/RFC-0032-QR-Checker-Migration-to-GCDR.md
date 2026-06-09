# RFC-0032 — QR Checker Migration to GCDR (Backend, Data, MCP)

> **Note (2026-06-08):** The backend domain was renamed `qrc`→`wo` (Work Orders) — tables are now `wo_*` and routes are `/api/v1/wo/*`. This historical RFC keeps the original `qrc` naming throughout; see [WO-OS-MAP.md](./WO-OS-MAP.md) for the current domain map.

- **Status:** Phases 1–4 ✅ done; **Phases 5–8 RETIRED** — greenfield validated, `qrcode-check.git` archived without data migration.
- **Created:** 2026-04-27
- **Last updated:** 2026-04-30
- **Author:** MYIO Engineering
- **Domain:** Domain consolidation / Multi-stack reduction / MCP
- **Builds on:**
  - [RFC-0009 — Events Audit Logs](./RFC-0009-Events-Audit-Logs.md)
  - [RFC-0030 — MYIO Wiki (file_assets, public_slug, S3 layout)](./RFC-0030-MYIO-Wiki-Knowledge-Base.md)
  - [RFC-0030 — S3 Bucket Setup](./RFC-0030-S3-Bucket-Setup.md)
  - [FILE-ASSETS-FRONTEND.md](./FILE-ASSETS-FRONTEND.md)

## Status snapshot (2026-04-30)

| Phase | Description                                                   | Status                                |
|-------|---------------------------------------------------------------|---------------------------------------|
| 1     | DB schema + entities (migrations 0024 + 0025)                  | ✅ done (`005b746`)                    |
| 2     | Auth — operator-pin login + bcrypt PIN storage                | ✅ done (`e66983c`)                    |
| 3     | Repositories + Services + audit emission                       | ✅ done (`cf573ce`, tests `0371309`)   |
| 4     | Controllers + ~48 routes mounted + OpenAPI                     | ✅ done (`4dd305b`, `b46f56e`)         |
| 5     | Data migration script (SQLite → Postgres)                      | ❌ **RETIRED** (no data migration)      |
| 6     | MCP server port (10 tools)                                     | ❌ **RETIRED**                          |
| 7     | MCP expansion (+12 tools: customers / wiki / observability)    | ❌ **RETIRED**                          |
| 8     | Cutover (freeze, dry-run, migrate, sample-test)                | ❌ **RETIRED** (depended on Phase 5)    |

### Why RETIRED (decision)

The team's goal was to **validate the GCDR backend (Phases 1–4) end-to-end as if the project were greenfield** — wire the FE up, exercise the full navigation against a clean Postgres, and confirm the API surface is adherent to the product flows.

**Decision (2026-06-08):** greenfield validation succeeded, the API is adherent, and no historical data needs to survive. **Phases 5 and 8 are RETIRED** — `qrcode-check.git` is archived without migration; the SQLite→Postgres migration will not be implemented. **Phases 6 and 7 (MCP) are also RETIRED** as out of scope for the core product (they only unlocked NL/Claude access to the data). The backend domain was subsequently renamed `qrc`→`wo`.

**What's live today:** the GCDR backend exposes `/api/v1/qrc/*` and `/api/v1/auth/operator-pin`. The frontend can re-point at GCDR and run end-to-end against an empty Postgres for validation. No legacy data is being touched.

**Companion docs for the deferred work:**
- [Phase 5 — Data Migration Script](./RFC-0032-QR-Checker-Migration-to-GCDR-Phase-5.md)
- [Source DB Structure (SQLite)](./RFC-0032-QR-Checker-Migration-to-GCDR-DATABASE-Structure-QRCODE-CHECKER.md)
- [Frontend Integration Guide](./FRONTEND-RFC-0032-QR-Checker.md)

## Companion documents

- [RFC-0030 — Wiki](./RFC-0030-MYIO-Wiki-Knowledge-Base.md) — file_assets table,
  public_slug feature, S3 conventions reused throughout this RFC.
- [RFC-0009 — Audit Logs](./RFC-0009-Events-Audit-Logs.md) — generic audit
  surface; QR-specific installation_audit table is layered on top, NOT a
  replacement.

---

## Why this matters

MYIO operates a standalone Next.js app called **QR Checker** at
`C:\Projetos\GitHub\myio\qrcode-check.git` for tracking device installations
across MYIO customer sites — typically shopping malls, but the same
workflow applies to industrial plants, hospitals, residential buildings,
and anywhere MYIO deploys metering hardware. Field technicians scan QR
codes on devices, log installation details (position, TC type, photos,
multipliers), and administrators manage customers/users/exports.

The app stack today is:

- Next.js 16 + React 19
- **SQLite** via better-sqlite3 (single file, WAL mode)
- Local filesystem for installation images (`{DATA_DIR}/installation-images/`)
- Cookie-based stateful sessions (UUID tokens stored in DB)
- Plaintext PINs and Base64-encoded passwords
- An embedded **MCP server** (10 read-only tools) so Claude can query
  installation data via natural language

The QR Checker schema models the customer concept under the local name
`malls` because the original use case was shopping centers. **The
business reality is more general**: a "mall" in the QR Checker DB is just
a customer site where MYIO deploys QR-tagged hardware. Every QR Checker
"mall" is a GCDR customer; not every GCDR customer is set up for QR
Checker. **The migration drops the standalone `malls` concept and treats
QR Checker as an opt-in feature on top of GCDR's existing
`customers`** — exactly mirroring how the Wiki module relates to
customers via `tenant_id`-scoped queries today.

This duplicates infrastructure GCDR already provides at industrial scale:

- **Multi-tenant data plane** with `tenant_id`-scoped queries on every
  read/write, partial unique indexes, soft delete throughout
- **JWT-based auth** with multiple audiences and a master-key fallback for
  M2M
- **RBAC** (policies + roles + role assignments) — including the
  customer-scoped role assignments that already replace QR Checker's
  bespoke `user_malls` table
- **S3-backed file storage** via the FileAssets module (RFC-0030 Phase 4)
  with content-addressed keys, signed download URLs, public slug aliases,
  and lifecycle-rule purging
- **Drizzle migrations** (versioned, gated, reproducible) instead of
  schema-on-startup
- **Audit logs** (RFC-0009) writing to Postgres with PII-aware sanitisation
- **`customers` table** with name, code (slug equivalent), email,
  externalId, address (jsonb), metadata (jsonb), and a hierarchy via
  `parent_customer_id` — already covers everything QR Checker stored on
  its `malls` table.

Running QR Checker as its own stack means **two production databases, two
auth systems, two S3 layouts (one of which is the local disk), two log
streams, two deploys, two on-call surfaces**, and a duplicated customer
master record that drifts from the GCDR commercial hierarchy. It has
known security gaps (plaintext PINs, Base64 "hashed" passwords) that
GCDR does not. The MCP server is QR-Checker-only — Claude has no way to
query GCDR's wiki, alarm bundles, customers, or audit logs. Every minute
QR Checker stays separate is a minute of doubled operational overhead
and lost product value.

**This RFC formalises the migration of QR Checker's backend into GCDR**:

- The `malls` table is merged into `customers`. QR-Checker-specific
  customer extras (viewer password, default central) live in a thin
  opt-in extension table `qrc_customer_settings` keyed 1:1 to customers.
- All other QR Checker tables move to Postgres alongside existing GCDR
  tables, prefixed `qrc_*`.
- Installation images move into the existing `myio-knowledge-prod` S3
  bucket via the FileAssets API.
- Field technicians' PIN-based auth bridges into GCDR's JWT model
  without breaking the on-the-floor workflow.
- The MCP server is ported into the GCDR codebase **and expanded** with
  12 new tools covering customers, alarm bundles, wiki, files, and audit
  logs — making Claude able to reason about the entire MYIO platform,
  not just QR Checker.
- The frontend (Next.js UI) explicitly stays where it is for now;
  re-pointing it at GCDR endpoints is a separate, downstream effort.

---

## Summary

Move QR Checker's backend, data, and files into GCDR in 8 phases:

1. **Schema** — new `qrc_*` tables in Postgres + 1 thin extension table
   on customers (`qrc_customer_settings`) + 3 nullable columns added to
   the existing `devices` table.
2. **Auth** — new `POST /api/v1/auth/operator-pin` endpoint mints JWTs
   from 4-digit PINs; PINs hashed with bcrypt at rest.
3. **Repos + services** — TypeScript layer mirroring GCDR conventions,
   zero overlap with the existing `customers` repo (just a new
   `qrcCustomerSettings` repo for the opt-in extension).
4. **Controllers** — `~25` endpoints under `/api/v1/qrc/*`, all
   customer-scoped via the existing customer-id path pattern; no
   `/malls/*` routes.
5. **Data migration** — one-shot idempotent script reads SQLite, **upserts
   each mall into customers** by `code` (the slug becomes the customer
   code), creates `qrc_customer_settings` rows for the QR-specific
   extras, writes installations/audit/tasks to the new tables, uploads
   images via FileAssets API.
6. **MCP port** — bring `src/mcp/` from qrcode-check, replace its DB
   layer with GCDR's Drizzle repos, rename "mall" tools to
   "customer" tools.
7. **MCP expansion** — 12 new GCDR-domain tools.
8. **Cutover** — hard cutover on a coordinated weekend window.

Every phase ships as a separate commit, gated by per-commit user approval
per the no-commit-without-ok feedback rule.

---

## Motivation

Concrete operational pain points that the migration removes:

- **Two databases, two backups.** Today an SRE on-call must know about
  Postgres AND the SQLite file inside the QR Checker container. Post-
  migration: one Postgres, one backup story.
- **Customer drift between systems.** QR Checker's `malls` table
  duplicates GCDR's `customers`. Today, when commercial onboards a new
  customer in GCDR, ops must also create it in QR Checker manually. Post-
  migration: customers exist in one place; "QR-enabled" is a flip in
  `qrc_customer_settings`.
- **Plaintext-PIN security gap.** Today, anyone with read access to the
  SQLite file can recover every field technician's PIN. Post-migration,
  PINs are bcrypt-hashed.
- **No cross-domain MCP.** Claude can list malls and query installation
  progress, but it cannot tell you which alarm rules are firing on the
  devices it just listed, nor cross-reference an installation with its
  customer in the GCDR commercial hierarchy. After expansion, Claude
  reasons across the whole platform.
- **Duplicated S3 cost & audit.** QR Checker images are on the
  filesystem — no versioning, no encryption-at-rest, no lifecycle, no
  signed URLs, no audit. Move to S3 and all of that comes for free.
- **Schema-on-startup is a foot-gun in production.** Drizzle versioned
  migrations give us reproducible, reviewable schema state.

---

## Guide-level explanation

### Concepts

#### Customer (QR-enabled)

A **customer** in GCDR is the universal commercial entity (with type
`HOLDING | COMPANY | BRANCH | FRANCHISE`). QR Checker doesn't introduce
a separate "mall" entity — it just adds optional configuration to the
customers that use QR Checker:

- A row in `qrc_customer_settings` (keyed 1:1 with `customers.id`) holds
  the QR-specific extras: `viewer_password_hash`, `default_central_id`
  (which gateway is the entry point), `qrc_metadata` (JSONB for future
  growth without schema churn).
- Presence of a `qrc_customer_settings` row marks a customer as
  "QR-enabled". Absent → not a mall, not visible to the QR Checker mobile
  app.
- Field technicians scan QR codes against devices that already belong
  to such a customer (via the existing `devices.customer_id` FK).
- The "slug" that QR Checker mobile uses today (e.g.
  `https://qr-checker/malls/shopping-mont-serrat`) maps to
  `customers.code` (already unique per tenant in GCDR — `varchar(50)`).

This makes QR Checker a *feature flag on top of customers*, not a
parallel hierarchy.

#### Installation

An **installation** is the record that a specific physical device has
been deployed in a specific position on the customer's site, with a
specific metering configuration (TC type, current/voltage multipliers,
optional `impedimento_text` flag for blocked / removed / defective).
Each device has at most one installation; once created, it's never
deleted — only its status field changes. Each change produces an
immutable row in `qrc_installation_audit` with a monotonically
increasing revision number. `qrc_installations.customer_id` is
denormalised from `devices.customer_id` for fast filtering, but the
device is the canonical owner.

#### Field operator (PIN-based identity)

A **field operator** is a technician on the floor of the customer's
site, holding a phone, tapping a 4-digit PIN to authenticate. They
never see an email form, never reset a password, never deal with JWT.
Their workflow is:

```
open app → tap PIN → POST /api/v1/auth/operator-pin
                  ← { token: <JWT 24h>, user: {...} }
                  → all subsequent calls carry that JWT
                  → standard GCDR auth from here on
```

The operator never knows the JWT exists. The migration is invisible to
them; the security model underneath is now consistent with the rest of
the platform. PIN access is gated by GCDR's existing customer-scoped
RBAC — a field operator gets `role:field-operator` with
`scope: customer:<uuid>` for each customer they're assigned to. No new
`user_malls` table needed.

#### Operator-PIN auth flow

```
                  ┌─────────────────────────────────┐
   field client   │                                 │
       │         POST /auth/operator-pin            │
       │  { pin: "1234", tenantId: "11111111-..." } │
       ▼─────────────────────────────────────────►  │
                                                    │
                  ┌──────────────────────────────┐  │
                  │ users WHERE qrc_field_pin =  │  │
                  │   bcrypt.compareSync(pin, h) │  │
                  │   AND tenant_id = $1         │  │
                  │   AND deleted_at IS NULL     │  │
                  └──────────────────────────────┘  │
                                                    │
                  match → mint JWT                  │
                          { sub: user.id,           │
                            tenant_id: ...,         │
                            roles: ['field-operator'],│
                            type: 'CUSTOMER',       │
                            exp: now + 86400 }      │
                                                    │
       ◄────────  201 { token, user, customers } ───┘
       │
       │  Authorization: Bearer <token>
       ▼  Standard GCDR endpoints from here on.
```

The response includes the list of customers the operator has access to
(read from `role_assignments` with scope = `customer:<uuid>` and
joining customers that have `qrc_customer_settings`).

#### Visita técnica (technical site visit)

QR Checker has a separate workflow called **Visita Técnica** for
non-installation site surveys (counting AC units in a room, taking
inventory of equipment, capturing observations). Distinct from
installations because it's not tied to a specific device — it's a
site walk-through. New tables: `qrc_visitas_tecnicas`,
`qrc_visita_ambientes`, `qrc_visita_ambiente_entries`,
`qrc_visita_products`, `qrc_visita_observations`, `qrc_visita_audit`.
Optionally tied to a customer via `qrc_visitas_tecnicas.customer_id`
(nullable — visitas can pre-exist a customer assignment).

User-visita assignment uses the same RBAC pattern: a role with
`scope: visita:<uuid>` instead of a dedicated junction table.

#### File assets reuse (no new image table per feature)

Every installation photo, customer observation photo, visita ambiente
photo, and visita product photo flows through the existing
`POST /api/v1/files` (FileAssets API). Five new owner_type values are
added to the CHECK constraint:

```
qrc_installation        — installation photos
qrc_customer_observation — customer-level free-text observation photos
qrc_visita_ambiente     — environment / room photos in a site visit
qrc_visita_product      — product inventory photos
qrc_visita_observation  — visita-level free-text observation photos
```

Thin join tables (`qrc_installation_images`, `qrc_visita_ambiente_images`,
`qrc_visita_product_images`) hold QR-Checker-specific metadata — image
ordering, captions. Binary content, sha256, content type, S3 key,
signed-URL minting all reuse the FileAssets implementation as-is.

#### MCP server, tool catalog after expansion

Two transport modes:

- **stdio** (default for Claude Desktop / Cursor / Claude Code) — server
  forks at startup, listens on stdin, writes responses to stdout.
- **HTTP** (mounted at `/api/v1/mcp/route` SSE) — for browser-side
  Claude integrations within MYIO's own apps.

Tools are organised in three groups:

```
PORTED FROM qrcode-check (10, read-only) — renamed for the
customer-centric model:
  list_qrc_customers          (was: list_malls)
  find_qrc_customer           (was: find_mall)
  get_devices                 (unchanged — already neutral name)
  get_device_details          (unchanged)
  get_maintenance_tasks       (unchanged)
  get_installation_progress   (was: get_progress)
  get_average_install_time    (was: get_average_time)
  get_technician_performance  (unchanged)
  get_activity_log            (unchanged)
  get_daily_summary           (unchanged)

NEW — GCDR commercial domain (4):
  list_customers              find_customer
  get_customer_devices        list_alarm_rules

NEW — GCDR knowledge & content (5):
  search_wiki                 get_wiki_page
  get_wiki_backlinks          list_files
  get_file_by_slug

NEW — GCDR observability (3):
  get_alarm_bundle            get_audit_logs
  get_tenant_summary
```

Total: **22 tools**, all read-only in v1. Tenant scoping is implicit via
the master API key the MCP server holds in its environment; v2 will
expose a `tenantId` parameter on every tool for multi-tenant LLM
deployments.

The QR-flavoured `list_qrc_customers` returns only customers with a
`qrc_customer_settings` row (i.e., QR-enabled), while the generic
`list_customers` returns all of them.

---

## Reference-level explanation

### Database schema (migrations 0024 + 0025)

#### Migration 0024 — `qrc_*` tables

```sql
-- ─── Migration 0024: QR Checker module — core tables ─────────────────────────
-- Reuses GCDR's existing `customers` table for site identity.
-- `qrc_customer_settings` is the opt-in extension that marks a customer
-- as "QR-enabled" and holds QR-specific configuration.

-- 1) Opt-in extension on customers
CREATE TABLE "qrc_customer_settings" (
  "customer_id"            uuid        PRIMARY KEY REFERENCES "customers"("id") ON DELETE CASCADE,
  "tenant_id"              uuid        NOT NULL,
  "viewer_password_hash"   text,                          -- bcrypt; nullable
  "default_central_id"     uuid,                          -- FK to centrals
  "qrc_metadata"           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "created_by"             uuid        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_qrc_cust_tenant"
  ON "qrc_customer_settings" ("tenant_id");

-- 2) PIN credential on existing users — TWO-COLUMN design
--
-- Why two columns:
--   bcrypt uses a random per-row salt → the SAME plaintext PIN produces
--   DIFFERENT hashes for different users. A unique index on the bcrypt
--   column does NOT enforce per-tenant PIN uniqueness, and looking up a
--   user by PIN would require scanning every row + bcrypt-comparing each.
--   Both fatal.
--
--   qrc_field_pin_lookup CHAR(64)
--     deterministic HMAC-SHA256(QRC_PIN_PEPPER, tenantId || ':' || pin)
--     → fast O(1) lookup AND real per-tenant unique constraint (collisions
--       across users in the same tenant become impossible)
--
--   qrc_field_pin_hash TEXT
--     bcrypt(pin) with cost 10
--     → slow offline cracking; even if the lookup column is leaked, an
--       attacker must brute-force bcrypt to verify their guess
--
-- The pepper lives in env var QRC_PIN_PEPPER (32 random hex bytes minimum,
-- generated once via `openssl rand -hex 32`). Rotating the pepper
-- invalidates ALL stored PINs — they must be re-set by the field
-- operators or admins.
ALTER TABLE "users"
  ADD COLUMN "qrc_field_pin_lookup" char(64),
  ADD COLUMN "qrc_field_pin_hash"   text;

CREATE UNIQUE INDEX "uq_users_tenant_qrc_pin_lookup"
  ON "users" ("tenant_id", "qrc_field_pin_lookup")
  WHERE "qrc_field_pin_lookup" IS NOT NULL;

-- 3) Installations (one per device, after technician deploys it)
CREATE TABLE "qrc_installations" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "device_id"              uuid        NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "customer_id"            uuid        NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
                                       -- denormalised from devices.customer_id for fast filtering
  "position"               text        NOT NULL,
  "tc_type"                text,        -- 50A | 100A | 400A | 1000A | 2000A
  "impedimento_text"       text        NOT NULL DEFAULT 'instalado'
                                       CHECK ("impedimento_text" IN
                                         ('instalado','impedimento','removido','defeito')),
  "obs"                    text,
  "current_multiplier"     numeric,
  "voltage_multiplier"     numeric,
  "installed_by"           uuid        NOT NULL,        -- users.id (operator)
  "installed_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now(),
  "deleted_at"             timestamptz,
  CONSTRAINT "qrc_installations_device_unique"
    UNIQUE ("tenant_id", "device_id")
);
CREATE INDEX "idx_qrc_installations_tenant_customer"
  ON "qrc_installations" ("tenant_id", "customer_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "idx_qrc_installations_status"
  ON "qrc_installations" ("tenant_id", "impedimento_text");

-- 4) Installation images — thin join to file_assets
CREATE TABLE "qrc_installation_images" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "installation_id"        uuid        NOT NULL REFERENCES "qrc_installations"("id") ON DELETE CASCADE,
  "file_asset_id"          uuid        NOT NULL,        -- references file_assets.id
  "image_order"            integer     NOT NULL DEFAULT 0,
  "caption"                text,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "qrc_installation_images_count_check"
    CHECK ("image_order" >= 0 AND "image_order" < 20)
);
CREATE INDEX "idx_qrc_installation_images_install"
  ON "qrc_installation_images" ("installation_id", "image_order");

-- 5) Installation audit (immutable revision log)
CREATE TABLE "qrc_installation_audit" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "installation_id"        uuid        NOT NULL REFERENCES "qrc_installations"("id") ON DELETE CASCADE,
  "revision"               integer     NOT NULL,
  "change_type"            text        NOT NULL
                                       CHECK ("change_type" IN
                                         ('created','updated','deleted','image_added','image_removed','task_created','task_completed')),
  "change_description"     text,
  "old_value"              jsonb,
  "new_value"              jsonb,
  "changed_by"             uuid        NOT NULL,
  "changed_at"             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "qrc_installation_audit_revision_unique"
    UNIQUE ("installation_id", "revision")
);
CREATE INDEX "idx_qrc_installation_audit_chrono"
  ON "qrc_installation_audit" ("installation_id", "changed_at" DESC);

-- 6) Maintenance tasks
CREATE TABLE "qrc_maintenance_tasks" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "installation_id"        uuid        NOT NULL REFERENCES "qrc_installations"("id") ON DELETE CASCADE,
  "description"            text        NOT NULL,
  "status"                 text        NOT NULL DEFAULT 'pending'
                                       CHECK ("status" IN
                                         ('pending','pending_review','resolved','removido')),
  "created_by"             uuid        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "completed_by"           uuid,
  "completed_at"           timestamptz,
  "completed_notes"        text,
  "reviewed_by"            uuid,
  "reviewed_at"            timestamptz
);
CREATE INDEX "idx_qrc_maintenance_tenant_status"
  ON "qrc_maintenance_tasks" ("tenant_id", "status") WHERE "status" != 'resolved';

-- 7) Customer-level observations (formerly mall_observations)
CREATE TABLE "qrc_customer_observations" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "customer_id"            uuid        NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "observation"            text        NOT NULL,
  "file_asset_id"          uuid,                          -- optional photo
  "created_by"             uuid        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_qrc_cust_obs_chrono"
  ON "qrc_customer_observations" ("customer_id", "created_at" DESC);

-- 8) Visitas Técnicas
CREATE TABLE "qrc_visitas_tecnicas" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "customer_id"            uuid        REFERENCES "customers"("id") ON DELETE SET NULL,
                                       -- nullable: visita may exist before customer assignment
  "name"                   text        NOT NULL,
  "observation"            text,
  "status"                 text        NOT NULL DEFAULT 'pending'
                                       CHECK ("status" IN
                                         ('pending','in_progress','done')),
  "created_by"             uuid        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now(),
  "deleted_at"             timestamptz
);

CREATE TABLE "qrc_visita_ambientes" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "visita_id"              uuid        NOT NULL REFERENCES "qrc_visitas_tecnicas"("id") ON DELETE CASCADE,
  "name"                   text        NOT NULL,
  "observation"            text,
  "ac_quantity"            integer,
  "product_quantity"       integer,
  "product_type"           text,
  "created_by"             uuid        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now(),
  "updated_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "qrc_visita_ambiente_images" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "ambiente_id"            uuid        NOT NULL REFERENCES "qrc_visita_ambientes"("id") ON DELETE CASCADE,
  "file_asset_id"          uuid        NOT NULL,
  "image_order"            integer     NOT NULL DEFAULT 0,
  "caption"                text,
  "created_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "qrc_visita_products" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "ambiente_id"            uuid        NOT NULL REFERENCES "qrc_visita_ambientes"("id") ON DELETE CASCADE,
  "product_type"           text        NOT NULL,
  "description"            text,
  "quantity"               integer     NOT NULL DEFAULT 1,
  "created_by"             uuid        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "qrc_visita_product_images" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "product_id"             uuid        NOT NULL REFERENCES "qrc_visita_products"("id") ON DELETE CASCADE,
  "file_asset_id"          uuid        NOT NULL,
  "image_order"            integer     NOT NULL DEFAULT 0,
  "created_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "qrc_visita_observations" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "visita_id"              uuid        NOT NULL REFERENCES "qrc_visitas_tecnicas"("id") ON DELETE CASCADE,
  "observation"            text        NOT NULL,
  "file_asset_id"          uuid,
  "created_by"             uuid        NOT NULL,
  "created_at"             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "qrc_visita_audit" (
  "id"                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"              uuid        NOT NULL,
  "visita_id"              uuid        NOT NULL REFERENCES "qrc_visitas_tecnicas"("id") ON DELETE CASCADE,
  "ambiente_id"            uuid,
  "revision"               integer     NOT NULL,
  "change_type"            text        NOT NULL,
  "change_description"     text,
  "old_value"              jsonb,
  "new_value"              jsonb,
  "changed_by"             uuid        NOT NULL,
  "changed_at"             timestamptz NOT NULL DEFAULT now()
);

-- 9) file_assets owner_type extension
ALTER TABLE "file_assets" DROP CONSTRAINT "file_assets_owner_type_check";
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_owner_type_check"
  CHECK ("owner_type" IN (
    'wiki_page', 'wiki_pdf', 'free',
    'qrc_installation', 'qrc_customer_observation',
    'qrc_visita_ambiente', 'qrc_visita_product', 'qrc_visita_observation'
  ));
```

**Tables NOT created** (each replaced by GCDR's existing equivalent):

| Was in qrcode-check | Replacement in GCDR |
|---|---|
| `malls` | `customers` (with optional `qrc_customer_settings` row) |
| `user_malls` | `role_assignments` with scope = `customer:<uuid>` |
| `user_visitas` | `role_assignments` with scope = `visita:<uuid>` |
| `sessions` | JWT (stateless) |

#### Migration 0025 — `devices` table extension

```sql
-- Migration 0025: extend devices with QR Checker metering fields
-- Nullable + additive — zero impact on existing rows.

ALTER TABLE "devices"
  ADD COLUMN "qrc_addr_low"   smallint,
  ADD COLUMN "qrc_addr_high"  smallint,
  ADD COLUMN "qrc_identifier" text;

-- Index used by /api/v1/qrc/install when client provides addr_low/high from QR
CREATE INDEX "idx_devices_qrc_addr"
  ON "devices" ("tenant_id", "qrc_addr_low", "qrc_addr_high")
  WHERE "qrc_addr_low" IS NOT NULL;
```

### TypeScript domain types (sketch)

```typescript
// src/domain/entities/qrc/CustomerSettings.ts
export interface QrcCustomerSettings {
  customerId: string;
  tenantId: string;
  viewerPasswordHash: string | null;
  defaultCentralId: string | null;
  qrcMetadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// src/domain/entities/qrc/Installation.ts
export type InstallationStatus =
  | 'instalado' | 'impedimento' | 'removido' | 'defeito';

export type TcType = '50A' | '100A' | '400A' | '1000A' | '2000A';

export interface Installation {
  id: string;
  tenantId: string;
  deviceId: string;
  customerId: string;          // denormalised from device for fast filtering
  position: string;
  tcType: TcType | null;
  status: InstallationStatus;  // maps to impedimento_text in DB
  obs: string | null;
  currentMultiplier: number | null;
  voltageMultiplier: number | null;
  installedBy: string;
  installedAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// + InstallationAudit, MaintenanceTask, CustomerObservation, VisitaTecnica,
//   VisitaAmbiente, VisitaProduct, etc.

// NO `Mall` entity. Customer access uses GCDR's existing `Customer` type.
```

### HTTP endpoints (~25 new under `/api/v1/qrc/*`)

All endpoints are customer-scoped via `customerId` in the path or body —
no `mall_id`, no slug-based routing, just GCDR's existing
customer-by-id pattern.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/operator-pin` | Mint JWT from PIN (top-level, NOT `/qrc/`) |
| `GET`  | `/api/v1/qrc/customers` | List QR-enabled customers (i.e., customers with a `qrc_customer_settings` row) the caller has access to |
| `POST` | `/api/v1/qrc/customers/:customerId/enable` | Mark a customer as QR-enabled (creates `qrc_customer_settings` row) |
| `PATCH`| `/api/v1/qrc/customers/:customerId/settings` | Update viewer password / default central / metadata |
| `POST` | `/api/v1/qrc/customers/:customerId/disable` | Soft-disable QR Checker for a customer (deletes settings row; data preserved) |
| `GET`  | `/api/v1/qrc/customers/:customerId/devices` | Devices for QR Checker workflow (joins `qrc_installations` for status) |
| `POST` | `/api/v1/qrc/customers/:customerId/devices/import` | Bulk JSON device import |
| `GET`  | `/api/v1/qrc/customers/:customerId/devices/export` | Bulk JSON device export |
| `POST` | `/api/v1/qrc/install` | **Field op** — record installation. Body: `{ deviceId? \| addrLow+addrHigh+customerId, position, tcType?, ... }`. Customer is resolved from device. |
| `GET`  | `/api/v1/qrc/installations/:id` | Installation detail + audit history |
| `PATCH`| `/api/v1/qrc/installations/:id` | Update fields + emit audit row |
| `GET`  | `/api/v1/qrc/installations/:id/images` | List installation images |
| `POST` | `/api/v1/qrc/installations/:id/images` | Upload — proxies to FileAssets API + writes join row |
| `PATCH`| `/api/v1/qrc/installations/:id/images/:imgId` | Update caption |
| `DELETE`| `/api/v1/qrc/installations/:id/images/:imgId` | Delete |
| `GET`  | `/api/v1/qrc/installations/:id/tasks` | List tasks |
| `POST` | `/api/v1/qrc/installations/:id/tasks` | Create task |
| `PATCH`| `/api/v1/qrc/installations/:id/tasks/:taskId` | Update status |
| `GET`  | `/api/v1/qrc/customers/:customerId/observations` | List customer-level observations |
| `POST` | `/api/v1/qrc/customers/:customerId/observations` | Add observation (with optional photo via FileAssets) |
| `GET`  | `/api/v1/qrc/customers/:customerId/report?format=xlsx\|json\|pdf` | Reports |
| `GET`  | `/api/v1/qrc/visitas` | List visitas |
| `POST` | `/api/v1/qrc/visitas` | Create visita (optionally `customerId`) |
| `GET`  | `/api/v1/qrc/visitas/:id` | Visita detail (ambientes, products, observations) |
| `PATCH`| `/api/v1/qrc/visitas/:id` | Update visita |
| `POST` | `/api/v1/qrc/visitas/:id/ambientes` | Add ambiente |
| `POST` | `/api/v1/qrc/visitas/:id/ambientes/:aid/products` | Add product |
| `GET`  | `/api/v1/qrc/visitas/:id/report?format=xlsx` | Visita report |

All endpoints follow GCDR's standard envelope (`{ success, data, meta }`),
multi-tenant scoping, and RBAC pattern.

### Operator-PIN authentication

Two-column PIN scheme — fast lookup via deterministic HMAC, slow verify
via bcrypt. Pepper from env var `QRC_PIN_PEPPER`.

```typescript
// src/services/QrcPinService.ts
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';

const PEPPER = process.env.QRC_PIN_PEPPER;
if (!PEPPER || PEPPER.length < 32) {
  throw new Error('QRC_PIN_PEPPER must be set (min 32 hex chars)');
}

/** Deterministic — same (tenantId, pin) always yields same lookup token. */
export function pinLookupToken(tenantId: string, pin: string): string {
  return createHmac('sha256', PEPPER!).update(`${tenantId}:${pin}`).digest('hex');
}

/** Slow, salted — only for verify, never for lookup. */
export async function pinHash(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function pinVerify(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
```

```typescript
// src/controllers/auth.controller.ts (extension)
router.post('/operator-pin', operatorPinRateLimiter, async (req, res, next) => {
  try {
    const { pin, tenantId } = OperatorPinSchema.parse(req.body);

    // 1) O(1) deterministic lookup — partial unique index on
    //    (tenant_id, qrc_field_pin_lookup) guarantees ≤ 1 match.
    const lookup = pinLookupToken(tenantId, pin);
    const user = await userRepository.getByQrcPinLookup(tenantId, lookup);

    // 2) Defence in depth — if lookup matches but bcrypt doesn't, treat as
    //    invalid (could happen if pepper rotated, hash didn't, or DB corrupted).
    if (!user || !user.qrcFieldPinHash || !(await pinVerify(pin, user.qrcFieldPinHash))) {
      throw new UnauthorizedError('Invalid PIN');
    }
    if (user.deletedAt) throw new UnauthorizedError('User deactivated');

    const token = signJwt({
      sub: user.id,
      tenant_id: tenantId,
      email: user.email,
      type: user.type,
      roles: ['field-operator', ...user.roles],
      exp: Math.floor(Date.now() / 1000) + 86400,  // 24h
    });

    // List QR-enabled customers the operator has access to
    const customers = await customerRepository.listForUserScopedToQrc(tenantId, user.id);
    sendSuccess(res, { token, user: toUserDTO(user), customers });
  } catch (e) { next(e); }
});
```

`customerRepository.listForUserScopedToQrc` joins:
- `role_assignments` filtered by user_id + active scope = `customer:<uuid>`
- `customers` for the customer rows
- `qrc_customer_settings` to filter only QR-enabled customers (INNER JOIN)

PIN write path (admin sets/rotates a field operator's PIN):

```typescript
// src/services/qrc/QrcOperatorService.ts
async setPin(adminCtx: Context, userId: string, newPin: string) {
  const user = await userRepository.getById(adminCtx.tenantId, userId);
  if (!user) throw new NotFoundError('User not found');

  // App-level uniqueness check is unnecessary because the partial unique
  // index on (tenant_id, qrc_field_pin_lookup) catches collisions at write time.
  const lookup = pinLookupToken(adminCtx.tenantId, newPin);
  const hash   = await pinHash(newPin);

  try {
    await userRepository.updateQrcPin(adminCtx.tenantId, userId, { lookup, hash });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ConflictError('PIN already taken in this tenant');
    }
    throw e;
  }
}
```

Two columns are updated atomically. `null` to clear (admin demotes the
field operator back to email-only).

`OperatorPinSchema`:

```typescript
export const OperatorPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits'),
  tenantId: z.string().uuid(),
});
```

**Brute-force protection**: rate-limit by `(tenantId, ip)` to 10 attempts /
5 minutes. Lock per-user after 5 wrong attempts in 1 hour (cooldown, not
permanent ban).

### Data migration script

`scripts/migrate-qrchecker.ts` — invoked manually, idempotent.

```bash
npm run migrate:qrchecker -- \
  --source ./qr-checker.db \
  --tenant 11111111-1111-1111-1111-111111111111 \
  --images-dir ./installation-images \
  [--dry-run]
  [--commit]
```

**Algorithm** (simplified):

```typescript
async function migrateQrChecker(opts: MigrateOpts) {
  const sqlite = new Database(opts.source, { readonly: true });

  // Legacy-id → uuid mapping for cross-table FK rewrites
  const idMap: Record<string, Map<number, string>> = {
    customers: new Map(),  // legacy mall.id → customers.id
    devices: new Map(),
    installations: new Map(),
    users: new Map(),
    visitas: new Map(),
    ambientes: new Map(),
    products: new Map(),
  };

  // Phase 1: malls → customers (UPSERT by code = legacy slug)
  for (const m of sqlite.prepare('SELECT * FROM malls').all()) {
    // If a customer with this code already exists in tenant, reuse it.
    // Otherwise create a new one with type='COMPANY' (sensible default;
    // operator can change in admin later).
    let customer = await customerRepo.getByCode(opts.tenant, m.slug);
    if (!customer) {
      customer = await customerRepo.create({
        tenantId: opts.tenant,
        name: m.name,
        displayName: m.name,
        code: m.slug,
        type: 'COMPANY',
        email: null,
        metadata: { cnpj: m.cnpj, qrcLegacyMallId: m.id },
        config: m.central_id ? { qrcCentralId: m.central_id } : undefined,
      }, opts.systemUserId);
    }
    idMap.customers.set(m.id, customer.id);

    // Always (re)write qrc_customer_settings to preserve viewer password
    await qrcCustomerSettingsRepo.upsert({
      customerId: customer.id,
      tenantId: opts.tenant,
      viewerPasswordHash: m.viewer_password_hash,
      defaultCentralId: m.central_id || null,
      qrcMetadata: { legacyMallId: m.id },
      createdBy: opts.systemUserId,
    });
  }

  // Phase 2: users — generate emails for PIN-only users; bcrypt PINs
  for (const u of sqlite.prepare('SELECT * FROM users').all()) {
    const id = randomUUID();
    idMap.users.set(u.id, id);
    const email = u.email || `pin-${u.pin}@qrchecker.myio-bas.com`;
    const pinHash = u.pin ? await bcrypt.hash(u.pin, 10) : null;
    const passwordHash = await bcrypt.hash(
      Buffer.from(u.password_hash, 'base64').toString(),  // un-Base64
      10
    );
    if (opts.commit) await userRepo.create({
      id, tenantId: opts.tenant, email, passwordHash, qrcFieldPinHash: pinHash,
      type: u.is_admin ? 'INTERNAL' : 'CUSTOMER',
      // ...
    });
  }

  // Phase 3: user_malls → role_assignments with scope=customer:<id>
  for (const um of sqlite.prepare('SELECT * FROM user_malls').all()) {
    const userId = idMap.users.get(um.user_id);
    const customerId = idMap.customers.get(um.mall_id);
    if (opts.commit) await roleAssignmentRepo.create({
      tenantId: opts.tenant,
      userId,
      roleKey: 'role:field-operator',
      scope: `customer:${customerId}`,
      grantedBy: opts.systemUserId,
    });
  }

  // Phase 4: devices — UPSERT into devices, set qrc_addr_low/high/identifier
  // (devices may already exist from GCDR ThingsBoard sync; merge by serialNumber/code)
  for (const d of sqlite.prepare('SELECT * FROM devices').all()) {
    const customerId = idMap.customers.get(d.mall_id);
    let device = await deviceRepo.getByExternalId(opts.tenant, d.device_id);
    if (!device) {
      device = await deviceRepo.create({
        tenantId: opts.tenant,
        customerId,
        name: d.name,
        type: d.type,
        serialNumber: d.device_id,
        qrcAddrLow: d.addr_low,
        qrcAddrHigh: d.addr_high,
        qrcIdentifier: d.identifier,
        // ...
      });
    } else {
      await deviceRepo.update(opts.tenant, device.id, {
        qrcAddrLow: d.addr_low,
        qrcAddrHigh: d.addr_high,
        qrcIdentifier: d.identifier,
      });
    }
    idMap.devices.set(d.id, device.id);
  }

  // Phase 5: installations
  for (const i of sqlite.prepare('SELECT * FROM installations').all()) {
    const installId = randomUUID();
    idMap.installations.set(i.id, installId);
    const deviceId = idMap.devices.get(i.device_id);
    const device = await deviceRepo.getById(opts.tenant, deviceId);
    if (opts.commit) await installationRepo.create({
      id: installId,
      tenantId: opts.tenant,
      deviceId,
      customerId: device.customerId,
      position: i.position,
      tcType: i.tc_type,
      status: i.impedimento_text || mapLegacyImpedimento(i.impedimento),
      obs: i.obs,
      currentMultiplier: i.current_multiplier,
      voltageMultiplier: i.voltage_multiplier,
      installedBy: idMap.users.get(/* parse i.installed_by */),
      installedAt: i.installed_at,
    });
  }

  // Phase 6: installation images — upload to S3 via FileAssets API
  for (const img of sqlite.prepare('SELECT * FROM installation_images').all()) {
    const installationId = idMap.installations.get(img.installation_id);
    const filePath = path.join(opts.imagesDir, img.image_path);
    if (!fs.existsSync(filePath)) {
      console.warn(`MISSING image: ${filePath}`);
      continue;
    }
    const buffer = fs.readFileSync(filePath);
    if (opts.commit) {
      const result = await fileAssetService.upload({
        tenantId: opts.tenant,
        userId: opts.systemUserId,
        ownerType: 'qrc_installation',
        ownerId: installationId,
        filename: img.image_path,
        contentType: detectContentType(filePath),
        body: buffer,
        metadata: { legacyImagePath: img.image_path, legacyId: img.id },
      });
      await qrcInstallationImageRepo.create({
        tenantId: opts.tenant,
        installationId,
        fileAssetId: result.asset.id,
        imageOrder: img.image_order,
        caption: img.caption,
      });
    }
  }

  // Phase 7-N: tasks, audits, observations (mall_observations →
  // qrc_customer_observations), visitas, etc.

  // Final summary
  console.log(`Migration complete:`);
  console.log(`  customers (qrc-enabled)=${idMap.customers.size}`);
  console.log(`  users=${idMap.users.size}`);
  // ...
}
```

**Re-run safety**: every insert path checks for existing rows by natural
key (e.g., `tenant_id` + `code` for customers, `tenant_id` +
`device_id`/`serialNumber` for devices, sha256 + tenant for files).
Re-running adds nothing if already migrated; logs which rows were
skipped.

### MCP server architecture

```
gcdr.git/
└── src/
    └── mcp/
        ├── server.ts                  # stdio + HTTP entry point
        ├── transport/
        │   ├── stdio.ts
        │   └── http.ts                # exposed at /api/v1/mcp/route + /sse
        ├── auth/
        │   └── master-key.ts          # GCDR_MASTER_API_KEY for v1
        ├── tools/
        │   ├── qrc/                   # ported from qrcode-check
        │   │   ├── list_qrc_customers.ts        (was: list_malls)
        │   │   ├── find_qrc_customer.ts         (was: find_mall)
        │   │   ├── get_devices.ts
        │   │   ├── get_device_details.ts
        │   │   ├── get_maintenance_tasks.ts
        │   │   ├── get_installation_progress.ts (was: get_progress)
        │   │   ├── get_average_install_time.ts  (was: get_average_time)
        │   │   ├── get_technician_performance.ts
        │   │   ├── get_activity_log.ts
        │   │   └── get_daily_summary.ts
        │   ├── customers/             # NEW
        │   │   ├── list_customers.ts           # all customers (no QR filter)
        │   │   ├── find_customer.ts
        │   │   ├── get_customer_devices.ts
        │   │   └── list_alarm_rules.ts
        │   ├── wiki/                  # NEW
        │   │   ├── search_wiki.ts
        │   │   ├── get_wiki_page.ts
        │   │   ├── get_wiki_backlinks.ts
        │   │   ├── list_files.ts
        │   │   └── get_file_by_slug.ts
        │   └── observability/         # NEW
        │       ├── get_alarm_bundle.ts
        │       ├── get_audit_logs.ts
        │       └── get_tenant_summary.ts
        ├── utils/
        │   ├── fuzzy-match.ts
        │   └── tool-schema.ts
        └── README.md
```

`list_qrc_customers` returns only customers with a row in
`qrc_customer_settings` (i.e., QR-enabled). `list_customers` returns
all customers in the tenant regardless. The two coexist on purpose —
one for the QR-Checker workflow, one for general MYIO platform queries.

### RBAC additions

New permissions added to the policies registry:

```
qrc.customer.{enable,disable,settings.update}
qrc.installation.{create,read,update,delete}
qrc.installation.image.{upload,read,delete}
qrc.maintenance.{create,read,update}
qrc.observation.{create,read,delete}
qrc.visita.{create,read,update,delete}
qrc.report.{read,export}
qrc.admin.users.manage
mcp.tool.read              # umbrella for all read-only MCP tools
```

New default role mappings:

| Role | Permissions | Typical scope |
|---|---|---|
| `field-operator` | `qrc.installation.{create,read,update}`, `qrc.installation.image.{upload,read}`, `qrc.observation.create` | `customer:<uuid>` per assigned customer |
| `qrc-admin` | full `qrc.*.*` | tenant-wide |
| `qrc-viewer` | `qrc.*.read` | `customer:<uuid>` per customer |

User-customer access uses **`role_assignments` only**, no dedicated
`user_malls` (or `user_customers`) table. This is the standard GCDR
pattern; no special-case code.

---

## Drawbacks

- **More tables** (~12 new, down from the originally proposed 15 thanks
  to merging malls into customers and dropping `user_malls` /
  `user_visitas`). The `qrc_*` namespace prefix mitigates cross-domain
  noise.
- **Migration risk.** A single 30-minute one-shot script handles real
  data. Backups before run, dry-run first, idempotent re-runs — all
  table stakes, but the risk of a bad mapping (e.g. installation
  pointing to wrong device) is non-trivial. Mitigation: run on a staging
  copy first, diff row counts, spot-check 10 random installations
  against the mobile UI.
- **MCP becomes tightly coupled to GCDR data layer.** Today QR Checker's
  MCP is loosely coupled (HTTP). After the move, MCP tools call Drizzle
  repos directly — if the schema changes, the tools must change.
  Acceptable because the MCP server lives in the same repo.
- **Operator-PIN bridge introduces a low-entropy credential** (10000
  possible PINs). Rate-limiting per IP+tenant + per-user lockouts
  mitigate brute force.
- **The frontend stays.** Until the Next.js UI is re-pointed, we run
  two HTTP layers. Schedule the UI cutover within 30 days of backend
  cutover to avoid the dual-layer becoming permanent.

---

## Alternatives considered

### Keep a separate `qrc_malls` table

Reproduce QR Checker's schema verbatim. Rejected: duplicates data
already in `customers` (name, slug, cnpj equivalent, address), forces
sync between two tables, breaks the "one customer record" principle
the rest of GCDR relies on.

### Add QR-specific columns directly to `customers`

`viewer_password_hash`, `qrc_default_central_id` etc. become columns on
the shared customers table. Rejected: pollutes a heavily-used core
table with feature-specific fields; future features (e.g. wiki, alarm)
would each want their own columns and the table grows unboundedly.
The `qrc_customer_settings` extension table keeps customer clean.

### Keep qrcode-check separate, add a webhook bridge

Each system stays in place; QR Checker emits webhooks on installation
events; GCDR consumes them into a shadow read-model. Rejected: doubles
the operational surface, introduces sync drift, doesn't address
security gaps.

### Replace qrcode-check entirely with a new Next.js UI inside GCDR

Rewrite the frontend at the same time. Rejected: rewrite cost is
significant (~3-4 weeks of UI work) and the existing mobile-friendly UX
is fine. Backend-first lets us de-risk the data side.

### PIN as a JWT claim instead of a credential

Embed PIN in JWT. Rejected: violates JWT statelessness (PIN rotation
requires JWT invalidation), and PINs are a credential, not an identity
claim.

### Per-feature MCP servers (one per app)

Run a QR-Checker MCP and a separate GCDR MCP. Rejected: forces every
LLM client to register both; cross-querying gets fractured. Single MCP
with grouped tools wins.

### Keep `user_malls` / `user_visitas` junction tables

Faster lookups than `role_assignments` for "list user's malls". Rejected:
duplicates RBAC. The `role_assignments` query with index on
`(user_id, scope)` is fast enough; consistency with the rest of the
platform outweighs micro-optimisation.

---

## Resolved decisions

- **No `qrc_malls` table** — every QR Checker mall is a `customers` row,
  optionally extended via `qrc_customer_settings` (1:1 opt-in).
- **No `user_malls` / `user_visitas` junction tables** — GCDR's
  `role_assignments` with `scope = customer:<uuid>` (or
  `visita:<uuid>`) covers the same intent.
- **`qrc_*` table prefix** for everything that genuinely is QR-Checker-
  specific.
- **Devices stay in the existing `devices` table** with 3 nullable
  columns added (`qrc_addr_low`, `qrc_addr_high`, `qrc_identifier`).
- **No new image table** — `file_assets` covers all binary storage.
  Thin join tables hold ordering and captions.
- **PIN auth bridge** — new `POST /api/v1/auth/operator-pin` mints JWT,
  PINs bcrypt-hashed.
- **MCP single server, two transports** (stdio + HTTP), 22 tools after
  expansion. QR-flavoured tools renamed to `*_qrc_customers` for the
  customer-scoped view.
- **Hard cutover** during a coordinated weekend window. No dual-write.
- **Tenant for migrated data**: `11111111-1111-1111-1111-111111111111`.
- **Frontend out of scope** — Next.js UI stays where it is until a
  separate decision is made.

---

## Unresolved questions

- **Volume**: production size of the QR Checker SQLite DB and
  installation-images directory is unknown. The script must handle
  small (<1k installations) or medium (~10k) ranges; if production
  turns out to be 100k+ rows or 100GB+ files, we need pagination + a
  resumable upload loop. Mitigation: dry-run first to know the count
  upfront.
- **Cutover window**: which Saturday morning. Coordinated with the
  field-team rotation calendar.
- **Mobile app re-pointing**: does the existing QR Checker mobile app
  point at a configurable API host, or is it hardcoded? If the latter,
  cutover requires a coordinated app release.
- **qrcode-check repo afterwards**: archived (read-only) or kept active
  for hotfixes during the dual-layer window.
- **Image format conversion**: today images have a sharp-resized cache
  (`installation-images-resized/`). Carry the cache forward or rebuild
  on-demand from the original after migration. Probably the latter —
  sharp + a `?w=600` query param on the FileAssets download endpoint,
  in a future RFC.
- **MCP authorization in v2**: the v1 master-key approach gives Claude
  full tenant access. v2 adds per-tool `tenantId` parameter and
  requires a tenant-scoped service token.
- **Operator PIN policy**: rotate every N months? Block sequential
  digits (1234, 0000)? Future security RFC.
- **Customer.type for migrated malls**: default to `COMPANY` in the
  migration script. Holding-customer-type and franchise-customer-type
  cases are explicit operator decisions post-migration.

---

## Implementation plan

8 phases. Each phase is one Git commit, gated by separate explicit
user OK per the no-commit-without-ok rule.

### Phase 1 — Database (migrations 0024 + 0025)

- `drizzle/migrations/0024_qrchecker_schema.sql` (12 new tables +
  `users.qrc_field_pin_lookup` (HMAC) + `users.qrc_field_pin_hash` (bcrypt) +
  partial unique index + file_assets owner_type extension)
- New env var `QRC_PIN_PEPPER` documented in `.env.example`
- `drizzle/migrations/0025_devices_metering_columns.sql`
- `src/infrastructure/database/drizzle/schema.ts` (extensions)
- `src/infrastructure/database/drizzle/db.ts` (type exports)
- `src/domain/entities/qrc/{CustomerSettings,Installation,
  InstallationAudit,MaintenanceTask,CustomerObservation,Visita,
  VisitaAmbiente,VisitaProduct}.ts`

**Done when**: typecheck passes, migrations apply on a fresh local
Postgres without errors, all CHECK constraints validated.

**Estimate**: 1.5 days.

### Phase 2 — Auth (operator-pin + bcrypt PIN storage)

- `src/dto/request/auth/OperatorPinSchema.ts`
- `src/services/AuthService.ts` (extend with `loginByPin`)
- `src/controllers/auth.controller.ts` (`POST /operator-pin`)
- Rate limiter middleware (per-IP + per-user)

**Done when**: integration test passes for valid PIN → JWT + invalid
PIN → 401 + brute-force lockout fires after 5 wrong attempts.

**Estimate**: 1 day.

### Phase 3 — Repositories & Services

- `src/repositories/qrc/{CustomerSettings,Installation,
  InstallationAudit,MaintenanceTask,CustomerObservation,Visita,
  VisitaAmbiente,VisitaProduct}Repository.ts` + interfaces
- `src/services/qrc/{CustomerSettings,Installation,Maintenance,
  Visita,Report}Service.ts`
- Extension on existing `customerRepository` and `userRepository` for
  `listForUserScopedToQrc` and `getByQrcPin` respectively (small,
  additive)

Reuse existing `IRepository` pattern, soft-delete semantics, audit
emission helpers.

**Done when**: unit tests cover service layer (CRUD + audit emission +
domain rules — installation can't be deleted, image limit = 20, etc.).

**Estimate**: 2 days (down from 2-3 in original plan because no
separate Mall repo needed).

### Phase 4 — Controllers & route mounting

- `src/controllers/qrc/{customers,installations,observations,reports,
  visitas,visita-ambientes,visita-products}.controller.ts`
- Mount under `/api/v1/qrc/*` in `src/app.ts`
- Reuse FileAssets controller for image upload (proxy via the
  installation-image controller wrapper that writes the join row)
- OpenAPI spec updates (~25 endpoints + ~12 schemas)

**Done when**: every endpoint reachable via curl, OpenAPI parses,
sample manual flow (enable customer → create device → install →
upload image → fetch installation) returns expected responses.

**Estimate**: 2 days.

### Phase 5 — Data migration script ⏸ STAND-BY

> **Status (2026-04-30):** on hold while greenfield validation runs.
> May be retired entirely if no historical data needs to survive.
> Detailed spec preserved for later in
> [RFC-0032 Phase 5 doc](./RFC-0032-QR-Checker-Migration-to-GCDR-Phase-5.md).
> Source schema reference:
> [DATABASE Structure of qrcode-check](./RFC-0032-QR-Checker-Migration-to-GCDR-DATABASE-Structure-QRCODE-CHECKER.md).

- `scripts/migrate-qrchecker.ts`
- `npm run migrate:qrchecker` script in `package.json`
- Reads SQLite source via `better-sqlite3`
- Writes Postgres via Drizzle service layer (audit emission for free)
- Uploads files via `fileAssetService.upload()` in-process
- Idempotent: skips existing rows by natural key (customer code,
  device serial number, sha256)

**Done when**: dry-run on a sample SQLite file outputs accurate
projected counts, full run persists every row, re-run as no-op.

**Estimate**: 2 days.

### Phase 6 — MCP server port ⏸ STAND-BY

> **Status (2026-04-30):** on hold. Independent from Phase 5 (no data
> dependency); no consumer blocked today. Resume only when there's a
> concrete user wanting NL/Claude access to QR data.

- `src/mcp/server.ts`
- `src/mcp/transport/{stdio,http}.ts`
- `src/mcp/auth/master-key.ts`
- `src/mcp/tools/qrc/*.ts` (10 ported tools, DB layer rewritten to use
  GCDR's Drizzle repos)
- Mount HTTP transport at `/api/v1/mcp/route` + SSE
- `npm run mcp:server` for stdio mode

**Done when**: stdio MCP server boots, an MCP client can call all 10
tools, responses match QR Checker's original shapes (customer-id keys
swapped for mall-id keys).

**Estimate**: 2 days.

### Phase 7 — MCP expansion (12 new tools) ⏸ STAND-BY

> **Status (2026-04-30):** on hold. Depends on Phase 6.

- `src/mcp/tools/customers/*.ts` (4 tools)
- `src/mcp/tools/wiki/*.ts` (5 tools)
- `src/mcp/tools/observability/*.ts` (3 tools)

**Done when**: all 22 tools listed via `tools/list`; each new tool has
a smoke test.

**Estimate**: 3 days.

### Phase 8 — Cutover ⏸ STAND-BY (gated by Phase 5)

> **Status (2026-04-30):** on hold. Cutover only makes sense if Phase 5
> ships — it *is* the act of executing the migration script in production.
> If greenfield validation succeeds and no legacy data needs to survive,
> this phase is retired entirely (the legacy app gets archived, not cut
> over).

- Pre-flight: backup SQLite + tarball of installation-images
- Window: chosen Saturday morning
- Steps:
  1. Freeze qrcode-check (set read-only flag or stop container)
  2. Run dry-run of migration script against latest SQLite
  3. Run full migration with `--commit`
  4. Diff row counts (Postgres customers with `qrc_customer_settings`
     row vs. SQLite malls; Postgres `qrc_installations` vs. SQLite
     `installations`; etc.)
  5. Sample-test 10 installations end-to-end
  6. If green: re-point mobile app to GCDR endpoints; if red: rollback
- Post-flight: monitor error logs for 48h; archive qrcode-check.

**Estimate**: 1 day window + 1 week soak.

**Total**: ~13 working days backend.

---

## Verification

### Schema verification (Phase 1)

```bash
docker compose up -d postgres
npm run db:migrate                # applies up through 0025
npm run typecheck                 # zero errors
psql $DATABASE_URL -c "SELECT count(*) FROM information_schema.tables \
  WHERE table_schema='public' AND table_name LIKE 'qrc_%';"
# expected: 11 (qrc_customer_settings, qrc_installations, qrc_installation_images,
#               qrc_installation_audit, qrc_maintenance_tasks,
#               qrc_customer_observations, qrc_visitas_tecnicas,
#               qrc_visita_ambientes, qrc_visita_ambiente_images,
#               qrc_visita_products, qrc_visita_product_images,
#               qrc_visita_observations, qrc_visita_audit) → 13 actually
```

### Auth verification (Phase 2)

```bash
# Valid PIN
curl -X POST http://localhost:3015/api/v1/auth/operator-pin \
  -H "Content-Type: application/json" \
  -d '{"pin":"1234","tenantId":"11111111-1111-1111-1111-111111111111"}'
# expected: 201 with { token, user, customers }

# Invalid PIN
curl -X POST http://localhost:3015/api/v1/auth/operator-pin \
  -d '{"pin":"9999","tenantId":"11111111-1111-1111-1111-111111111111"}'
# expected: 401

# After 5 wrong attempts: lockout
for i in {1..6}; do
  curl -X POST .../auth/operator-pin -d '{"pin":"0000","tenantId":"..."}'
done
# attempts 1-5: 401 UNAUTHORIZED
# attempt 6: 429 RATE_LIMITED
```

### Data migration verification (Phase 5)

```bash
# Dry run
npm run migrate:qrchecker -- \
  --source ./qr-checker.db \
  --tenant 11111111-1111-1111-1111-111111111111 \
  --images-dir ./installation-images \
  --dry-run

# Output expected (example):
#   PROJECTED:
#     5 malls → upsert into customers (3 new, 2 already-existing matched by code)
#     47 users (45 new, 2 already-existing matched by email)
#     1023 devices → upsert into devices (write qrc_addr_*)
#     814 installations
#     4070 images (~2.1 GB upload to S3)
#     219 audit rows, ...

# Full run
npm run migrate:qrchecker -- --source ./qr-checker.db \
  --tenant 11111111-1111-1111-1111-111111111111 \
  --images-dir ./installation-images --commit

# Verify
psql $DATABASE_URL <<SQL
SELECT
  (SELECT count(*) FROM qrc_customer_settings)        AS qrc_customers,
  (SELECT count(*) FROM qrc_installations)            AS installations,
  (SELECT count(*) FROM file_assets
     WHERE owner_type='qrc_installation')             AS images,
  (SELECT count(*) FROM role_assignments
     WHERE scope LIKE 'customer:%'
       AND role_key='role:field-operator')             AS field_op_grants;
SQL

# Numbers must match SQLite source counts.

# Spot check 1 installation
curl http://localhost:3015/api/v1/qrc/installations/<id> \
  -H "Authorization: Bearer <admin_jwt>" \
  -H "X-Tenant-Id: 11111111-1111-1111-1111-111111111111" | jq
# expected: full installation + audit history + N image references
```

### MCP verification (Phases 6 + 7)

```bash
npm run mcp:server   # boots stdio server

# Call list_qrc_customers (ported tool):
# {"name":"list_qrc_customers","arguments":{}}
# expected: same shape as qrcode-check's list_malls (renamed keys)

# Call list_customers (new tool):
# {"name":"list_customers","arguments":{}}
# expected: ALL customers in tenant, not just QR-enabled

# Call search_wiki:
# {"name":"search_wiki","arguments":{"q":"chiller"}}
# expected: matching wiki pages with snippets
```

### End-to-end cutover verification (Phase 8)

```bash
# Take a real qr-checker.db backup, run migration to staging GCDR.
# Open a real device in the field via the mobile app pointed at staging.
# Tap PIN → scan QR → take 3 photos → submit.
# Verify in staging Postgres:

SELECT i.*, count(img.id) AS image_count, c.name AS customer_name
FROM qrc_installations i
LEFT JOIN qrc_installation_images img ON img.installation_id = i.id
JOIN customers c ON c.id = i.customer_id
WHERE i.installed_at > now() - interval '5 minutes'
GROUP BY i.id, c.name;

# expected: 1 row, image_count = 3, customer_name = expected mall name

# Verify audit:
SELECT * FROM qrc_installation_audit
WHERE installation_id = '<id>'
ORDER BY revision;

# expected: 1+ rows describing the create event
```

---

## Appendix — directory layout (post-migration)

```
gcdr.git/
├── docs/
│   ├── RFC-0032-QR-Checker-Migration-to-GCDR.md          ← this RFC
│   └── QR-CHECKER-FRONTEND.md                             ← future
├── drizzle/migrations/
│   ├── 0024_qrchecker_schema.sql
│   └── 0025_devices_metering_columns.sql
├── scripts/
│   ├── migrate-qrchecker.ts                               ← one-shot
│   └── seeds/
│       └── 25-qrchecker-policies.sql                      ← RBAC bootstrap
├── src/
│   ├── controllers/
│   │   ├── auth.controller.ts                             ← +operator-pin
│   │   └── qrc/
│   │       ├── customers.controller.ts                    ← /enable, /settings
│   │       ├── installations.controller.ts
│   │       ├── observations.controller.ts
│   │       ├── reports.controller.ts
│   │       └── visitas.controller.ts
│   ├── domain/entities/qrc/
│   │   ├── CustomerSettings.ts
│   │   ├── Installation.ts
│   │   ├── InstallationAudit.ts
│   │   ├── MaintenanceTask.ts
│   │   ├── CustomerObservation.ts
│   │   ├── Visita.ts
│   │   └── (+ ambiente / product entities)
│   ├── dto/request/qrc/
│   │   └── *DTO.ts
│   ├── repositories/
│   │   ├── interfaces/qrc/
│   │   └── qrc/
│   │       └── *Repository.ts
│   ├── services/qrc/
│   │   ├── CustomerSettingsService.ts
│   │   ├── InstallationService.ts
│   │   └── (+ others)
│   └── mcp/
│       ├── server.ts
│       ├── transport/{stdio,http}.ts
│       ├── auth/master-key.ts
│       ├── tools/
│       │   ├── qrc/         (10 ported)
│       │   ├── customers/   (4 new)
│       │   ├── wiki/        (5 new)
│       │   └── observability/ (3 new)
│       └── utils/
└── tests/
    ├── unit/
    │   └── services/qrc/
    └── integration/
        ├── qrc-flow.test.ts
        └── mcp-tools.test.ts
```
