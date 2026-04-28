-- Migration 0024: RFC-0032 — QR Checker module schema
--
-- Brings the QR Checker domain into GCDR. Reuses customers/users/devices/
-- file_assets where possible. Per RFC, NO `qrc_malls` table and NO
-- `qrc_user_mall_access` — customers + role_assignments (with
-- `scope = customer:<uuid>`) cover both.
--
-- Companion: docs/RFC-0032-QR-Checker-Migration-to-GCDR.md

-- =============================================================================
-- 1) qrc_customer_settings — opt-in extension marking a customer as QR-enabled
-- =============================================================================

CREATE TABLE IF NOT EXISTS "qrc_customer_settings" (
  "customer_id"           uuid        PRIMARY KEY REFERENCES "customers"("id") ON DELETE CASCADE,
  "tenant_id"             uuid        NOT NULL,
  "viewer_password_hash"  text,                          -- bcrypt; nullable
  "default_central_id"    uuid,                          -- FK to centrals (no enforced FK to keep deletion semantics flexible)
  "qrc_metadata"          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "created_by"            uuid        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qrc_cust_settings_tenant"
  ON "qrc_customer_settings" ("tenant_id");

-- =============================================================================
-- 2) PIN credentials on users — two-column design (RFC §Operator-PIN auth)
--
--    qrc_field_pin_lookup CHAR(64)
--      deterministic HMAC-SHA256(QRC_PIN_PEPPER, tenantId || ':' || pin)
--      → fast O(1) lookup AND real per-tenant unique constraint
--
--    qrc_field_pin_hash TEXT
--      bcrypt(pin) with cost 10 → slow offline cracking
--
--    Pepper from env var QRC_PIN_PEPPER (≥ 32 hex chars).
-- =============================================================================

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "qrc_field_pin_lookup" char(64),
  ADD COLUMN IF NOT EXISTS "qrc_field_pin_hash"   text;

-- Real per-tenant uniqueness via the deterministic lookup column
CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_tenant_qrc_pin_lookup"
  ON "users" ("tenant_id", "qrc_field_pin_lookup")
  WHERE "qrc_field_pin_lookup" IS NOT NULL;

-- =============================================================================
-- 3) qrc_installations — one per device, never deleted (status only)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "qrc_installations" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "device_id"             uuid        NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "customer_id"           uuid        NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "position"              text        NOT NULL,
  "tc_type"               text,
  "impedimento_text"      text        NOT NULL DEFAULT 'instalado',
  "obs"                   text,
  "current_multiplier"    numeric,
  "voltage_multiplier"    numeric,
  "installed_by"          uuid        NOT NULL,
  "installed_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  "deleted_at"            timestamptz,
  CONSTRAINT "qrc_installations_device_unique"
    UNIQUE ("tenant_id", "device_id"),
  CONSTRAINT "qrc_installations_status_check"
    CHECK ("impedimento_text" IN ('instalado','impedimento','removido','defeito')),
  CONSTRAINT "qrc_installations_tc_type_check"
    CHECK ("tc_type" IS NULL OR "tc_type" IN ('50A','100A','400A','1000A','2000A'))
);

CREATE INDEX IF NOT EXISTS "idx_qrc_installations_tenant_customer"
  ON "qrc_installations" ("tenant_id", "customer_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_qrc_installations_status"
  ON "qrc_installations" ("tenant_id", "impedimento_text");
CREATE INDEX IF NOT EXISTS "idx_qrc_installations_device"
  ON "qrc_installations" ("device_id");

-- =============================================================================
-- 4) qrc_installation_images — thin join to file_assets
-- =============================================================================

CREATE TABLE IF NOT EXISTS "qrc_installation_images" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "installation_id"       uuid        NOT NULL REFERENCES "qrc_installations"("id") ON DELETE CASCADE,
  "file_asset_id"         uuid        NOT NULL,
  "image_order"           integer     NOT NULL DEFAULT 0,
  "caption"               text,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "qrc_installation_images_order_range"
    CHECK ("image_order" >= 0 AND "image_order" < 20),
  CONSTRAINT "qrc_installation_images_unique"
    UNIQUE ("installation_id", "file_asset_id")
);

CREATE INDEX IF NOT EXISTS "idx_qrc_installation_images_install"
  ON "qrc_installation_images" ("installation_id", "image_order");

-- =============================================================================
-- 5) qrc_installation_audit — immutable revision log
-- =============================================================================

CREATE TABLE IF NOT EXISTS "qrc_installation_audit" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "installation_id"       uuid        NOT NULL REFERENCES "qrc_installations"("id") ON DELETE CASCADE,
  "revision"              integer     NOT NULL,
  "change_type"           text        NOT NULL,
  "change_description"    text,
  "old_value"             jsonb,
  "new_value"             jsonb,
  "changed_by"            uuid        NOT NULL,
  "changed_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "qrc_installation_audit_revision_unique"
    UNIQUE ("installation_id", "revision"),
  CONSTRAINT "qrc_installation_audit_change_type_check"
    CHECK ("change_type" IN (
      'created','updated','deleted',
      'image_added','image_removed',
      'task_created','task_completed'
    ))
);

CREATE INDEX IF NOT EXISTS "idx_qrc_installation_audit_chrono"
  ON "qrc_installation_audit" ("installation_id", "changed_at" DESC);

-- =============================================================================
-- 6) qrc_maintenance_tasks
-- =============================================================================

CREATE TABLE IF NOT EXISTS "qrc_maintenance_tasks" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "installation_id"       uuid        NOT NULL REFERENCES "qrc_installations"("id") ON DELETE CASCADE,
  "description"           text        NOT NULL,
  "status"                text        NOT NULL DEFAULT 'pending',
  "created_by"            uuid        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "completed_by"          uuid,
  "completed_at"          timestamptz,
  "completed_notes"       text,
  "reviewed_by"           uuid,
  "reviewed_at"           timestamptz,
  CONSTRAINT "qrc_maintenance_status_check"
    CHECK ("status" IN ('pending','pending_review','resolved','removido'))
);

CREATE INDEX IF NOT EXISTS "idx_qrc_maintenance_tenant_status"
  ON "qrc_maintenance_tasks" ("tenant_id", "status") WHERE "status" != 'resolved';
CREATE INDEX IF NOT EXISTS "idx_qrc_maintenance_install"
  ON "qrc_maintenance_tasks" ("installation_id", "created_at" DESC);

-- =============================================================================
-- 7) qrc_customer_observations
-- =============================================================================

CREATE TABLE IF NOT EXISTS "qrc_customer_observations" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "customer_id"           uuid        NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "observation"           text        NOT NULL,
  "file_asset_id"         uuid,
  "created_by"            uuid        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qrc_cust_obs_chrono"
  ON "qrc_customer_observations" ("customer_id", "created_at" DESC);

-- =============================================================================
-- 8-12) Visitas Técnicas + nested entities
-- =============================================================================

CREATE TABLE IF NOT EXISTS "qrc_visitas_tecnicas" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "customer_id"           uuid        REFERENCES "customers"("id") ON DELETE SET NULL,
  "name"                  text        NOT NULL,
  "observation"           text,
  "status"                text        NOT NULL DEFAULT 'pending',
  "created_by"            uuid        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  "deleted_at"            timestamptz,
  CONSTRAINT "qrc_visitas_status_check"
    CHECK ("status" IN ('pending','in_progress','done'))
);

CREATE INDEX IF NOT EXISTS "idx_qrc_visitas_tenant_status"
  ON "qrc_visitas_tecnicas" ("tenant_id", "status") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_qrc_visitas_customer"
  ON "qrc_visitas_tecnicas" ("customer_id") WHERE "customer_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "qrc_visita_ambientes" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "visita_id"             uuid        NOT NULL REFERENCES "qrc_visitas_tecnicas"("id") ON DELETE CASCADE,
  "name"                  text        NOT NULL,
  "observation"           text,
  "ac_quantity"           integer,
  "product_quantity"      integer,
  "product_type"          text,
  "created_by"            uuid        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qrc_visita_ambientes_visita"
  ON "qrc_visita_ambientes" ("visita_id", "created_at");

CREATE TABLE IF NOT EXISTS "qrc_visita_ambiente_images" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "ambiente_id"           uuid        NOT NULL REFERENCES "qrc_visita_ambientes"("id") ON DELETE CASCADE,
  "file_asset_id"         uuid        NOT NULL,
  "image_order"           integer     NOT NULL DEFAULT 0,
  "caption"               text,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qrc_visita_ambiente_images_amb"
  ON "qrc_visita_ambiente_images" ("ambiente_id", "image_order");

CREATE TABLE IF NOT EXISTS "qrc_visita_products" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "ambiente_id"           uuid        NOT NULL REFERENCES "qrc_visita_ambientes"("id") ON DELETE CASCADE,
  "product_type"          text        NOT NULL,
  "description"           text,
  "quantity"              integer     NOT NULL DEFAULT 1,
  "created_by"            uuid        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "qrc_visita_products_quantity_positive"
    CHECK ("quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_qrc_visita_products_amb"
  ON "qrc_visita_products" ("ambiente_id");

CREATE TABLE IF NOT EXISTS "qrc_visita_product_images" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "product_id"            uuid        NOT NULL REFERENCES "qrc_visita_products"("id") ON DELETE CASCADE,
  "file_asset_id"         uuid        NOT NULL,
  "image_order"           integer     NOT NULL DEFAULT 0,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qrc_visita_product_images_prod"
  ON "qrc_visita_product_images" ("product_id", "image_order");

CREATE TABLE IF NOT EXISTS "qrc_visita_observations" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "visita_id"             uuid        NOT NULL REFERENCES "qrc_visitas_tecnicas"("id") ON DELETE CASCADE,
  "observation"           text        NOT NULL,
  "file_asset_id"         uuid,
  "created_by"            uuid        NOT NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qrc_visita_obs_chrono"
  ON "qrc_visita_observations" ("visita_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "qrc_visita_audit" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"             uuid        NOT NULL,
  "visita_id"             uuid        NOT NULL REFERENCES "qrc_visitas_tecnicas"("id") ON DELETE CASCADE,
  "ambiente_id"           uuid,
  "revision"              integer     NOT NULL,
  "change_type"           text        NOT NULL,
  "change_description"    text,
  "old_value"             jsonb,
  "new_value"             jsonb,
  "changed_by"            uuid        NOT NULL,
  "changed_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_qrc_visita_audit_chrono"
  ON "qrc_visita_audit" ("visita_id", "changed_at" DESC);

-- =============================================================================
-- 13) Extend file_assets owner_type CHECK with QRC values
-- =============================================================================

ALTER TABLE "file_assets" DROP CONSTRAINT IF EXISTS "file_assets_owner_type_check";
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_owner_type_check"
  CHECK ("owner_type" IN (
    'wiki_page', 'wiki_pdf', 'free',
    'qrc_installation', 'qrc_customer_observation',
    'qrc_visita_ambiente', 'qrc_visita_product', 'qrc_visita_observation'
  ));
