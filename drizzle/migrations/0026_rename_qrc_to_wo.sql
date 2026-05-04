-- Migration 0026: RFC-0032 — Rename QR Checker module from qrc_* to wo_*
--
-- Step 1 of the Work Orders rename. Database surface only — code/services/
-- DTOs/controllers/OpenAPI/docs follow in subsequent commits.
--
-- Rename catalog:
--   - 13 tables                                     qrc_*  → wo_*
--   - 5 columns (users 2 + devices 3)               qrc_*  → wo_*
--   - 1 column (wo_customer_settings.qrc_metadata)  qrc_*  → wo_*
--   - 17 indexes                                    idx_qrc_* / uq_*qrc* → idx_wo_* / uq_*wo*
--   - 10 named constraints                          qrc_*  → wo_*
--   - file_assets.owner_type CHECK + data           qrc_*  → wo_*
--
-- Strategy: ALTER ... RENAME TO. Preserves data, FKs, primary keys, and
-- all index/constraint definitions. Constraint and index names are renamed
-- explicitly because PostgreSQL does NOT auto-rename named DB objects when
-- the parent table renames.
--
-- The migration runs in a single implicit transaction (drizzle migrator
-- and psql both wrap each .sql file). On failure, no partial rename is
-- left behind.
--
-- Companion: docs/RFC-0032-QR-Checker-Migration-to-GCDR.md
--            (sections updated in the same commit set will refer to wo_*)

-- =============================================================================
-- 1) Tables (13)
-- =============================================================================

ALTER TABLE IF EXISTS "qrc_customer_settings"      RENAME TO "wo_customer_settings";
ALTER TABLE IF EXISTS "qrc_installations"          RENAME TO "wo_installations";
ALTER TABLE IF EXISTS "qrc_installation_images"    RENAME TO "wo_installation_images";
ALTER TABLE IF EXISTS "qrc_installation_audit"     RENAME TO "wo_installation_audit";
ALTER TABLE IF EXISTS "qrc_maintenance_tasks"      RENAME TO "wo_maintenance_tasks";
ALTER TABLE IF EXISTS "qrc_customer_observations"  RENAME TO "wo_customer_observations";
ALTER TABLE IF EXISTS "qrc_visitas_tecnicas"       RENAME TO "wo_visitas_tecnicas";
ALTER TABLE IF EXISTS "qrc_visita_ambientes"       RENAME TO "wo_visita_ambientes";
ALTER TABLE IF EXISTS "qrc_visita_ambiente_images" RENAME TO "wo_visita_ambiente_images";
ALTER TABLE IF EXISTS "qrc_visita_products"        RENAME TO "wo_visita_products";
ALTER TABLE IF EXISTS "qrc_visita_product_images"  RENAME TO "wo_visita_product_images";
ALTER TABLE IF EXISTS "qrc_visita_observations"    RENAME TO "wo_visita_observations";
ALTER TABLE IF EXISTS "qrc_visita_audit"           RENAME TO "wo_visita_audit";

-- =============================================================================
-- 2) Column inside renamed wo_customer_settings
-- =============================================================================

ALTER TABLE "wo_customer_settings"
  RENAME COLUMN "qrc_metadata" TO "wo_metadata";

-- =============================================================================
-- 3) PIN credential columns on users
-- =============================================================================

ALTER TABLE "users" RENAME COLUMN "qrc_field_pin_lookup" TO "wo_field_pin_lookup";
ALTER TABLE "users" RENAME COLUMN "qrc_field_pin_hash"   TO "wo_field_pin_hash";

ALTER INDEX IF EXISTS "uq_users_tenant_qrc_pin_lookup"
  RENAME TO "uq_users_tenant_wo_pin_lookup";

-- =============================================================================
-- 4) QR-payload metering columns on devices
-- =============================================================================

ALTER TABLE "devices" RENAME COLUMN "qrc_addr_low"   TO "wo_addr_low";
ALTER TABLE "devices" RENAME COLUMN "qrc_addr_high"  TO "wo_addr_high";
ALTER TABLE "devices" RENAME COLUMN "qrc_identifier" TO "wo_identifier";

ALTER INDEX IF EXISTS "idx_devices_qrc_addr" RENAME TO "idx_devices_wo_addr";

-- =============================================================================
-- 5) Indexes (17 — all qrc_-prefixed indexes from 0024)
-- =============================================================================

ALTER INDEX IF EXISTS "idx_qrc_cust_settings_tenant"          RENAME TO "idx_wo_cust_settings_tenant";
ALTER INDEX IF EXISTS "idx_qrc_installations_tenant_customer" RENAME TO "idx_wo_installations_tenant_customer";
ALTER INDEX IF EXISTS "idx_qrc_installations_status"          RENAME TO "idx_wo_installations_status";
ALTER INDEX IF EXISTS "idx_qrc_installations_device"          RENAME TO "idx_wo_installations_device";
ALTER INDEX IF EXISTS "idx_qrc_installation_images_install"   RENAME TO "idx_wo_installation_images_install";
ALTER INDEX IF EXISTS "idx_qrc_installation_audit_chrono"     RENAME TO "idx_wo_installation_audit_chrono";
ALTER INDEX IF EXISTS "idx_qrc_maintenance_tenant_status"     RENAME TO "idx_wo_maintenance_tenant_status";
ALTER INDEX IF EXISTS "idx_qrc_maintenance_install"           RENAME TO "idx_wo_maintenance_install";
ALTER INDEX IF EXISTS "idx_qrc_cust_obs_chrono"               RENAME TO "idx_wo_cust_obs_chrono";
ALTER INDEX IF EXISTS "idx_qrc_visitas_tenant_status"         RENAME TO "idx_wo_visitas_tenant_status";
ALTER INDEX IF EXISTS "idx_qrc_visitas_customer"              RENAME TO "idx_wo_visitas_customer";
ALTER INDEX IF EXISTS "idx_qrc_visita_ambientes_visita"       RENAME TO "idx_wo_visita_ambientes_visita";
ALTER INDEX IF EXISTS "idx_qrc_visita_ambiente_images_amb"    RENAME TO "idx_wo_visita_ambiente_images_amb";
ALTER INDEX IF EXISTS "idx_qrc_visita_products_amb"           RENAME TO "idx_wo_visita_products_amb";
ALTER INDEX IF EXISTS "idx_qrc_visita_product_images_prod"    RENAME TO "idx_wo_visita_product_images_prod";
ALTER INDEX IF EXISTS "idx_qrc_visita_obs_chrono"             RENAME TO "idx_wo_visita_obs_chrono";
ALTER INDEX IF EXISTS "idx_qrc_visita_audit_chrono"           RENAME TO "idx_wo_visita_audit_chrono";

-- =============================================================================
-- 6) Named CHECK / UNIQUE constraints (10)
--    PostgreSQL does not support IF EXISTS on RENAME CONSTRAINT, so these
--    require constraints to exist (which they do, from migration 0024).
-- =============================================================================

ALTER TABLE "wo_installations"
  RENAME CONSTRAINT "qrc_installations_device_unique" TO "wo_installations_device_unique";
ALTER TABLE "wo_installations"
  RENAME CONSTRAINT "qrc_installations_status_check" TO "wo_installations_status_check";
ALTER TABLE "wo_installations"
  RENAME CONSTRAINT "qrc_installations_tc_type_check" TO "wo_installations_tc_type_check";

ALTER TABLE "wo_installation_images"
  RENAME CONSTRAINT "qrc_installation_images_order_range" TO "wo_installation_images_order_range";
ALTER TABLE "wo_installation_images"
  RENAME CONSTRAINT "qrc_installation_images_unique" TO "wo_installation_images_unique";

ALTER TABLE "wo_installation_audit"
  RENAME CONSTRAINT "qrc_installation_audit_revision_unique" TO "wo_installation_audit_revision_unique";
ALTER TABLE "wo_installation_audit"
  RENAME CONSTRAINT "qrc_installation_audit_change_type_check" TO "wo_installation_audit_change_type_check";

ALTER TABLE "wo_maintenance_tasks"
  RENAME CONSTRAINT "qrc_maintenance_status_check" TO "wo_maintenance_status_check";

ALTER TABLE "wo_visitas_tecnicas"
  RENAME CONSTRAINT "qrc_visitas_status_check" TO "wo_visitas_status_check";

ALTER TABLE "wo_visita_products"
  RENAME CONSTRAINT "qrc_visita_products_quantity_positive" TO "wo_visita_products_quantity_positive";

-- =============================================================================
-- 7) file_assets.owner_type — drop CHECK, rewrite data, re-install CHECK
--
--    Order matters: the CHECK forbids any value outside its IN-list, so the
--    UPDATE has to run between DROP and ADD. In greenfield environments
--    the UPDATE is a no-op (zero rows match qrc_*); included for safety
--    on dev/homolog instances that may have test data.
-- =============================================================================

ALTER TABLE "file_assets" DROP CONSTRAINT IF EXISTS "file_assets_owner_type_check";

UPDATE "file_assets"
   SET "owner_type" = 'wo_' || substring("owner_type" FROM 5)
 WHERE "owner_type" LIKE 'qrc_%';

ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_owner_type_check"
  CHECK ("owner_type" IN (
    'wiki_page', 'wiki_pdf', 'free',
    'wo_installation', 'wo_customer_observation',
    'wo_visita_ambiente', 'wo_visita_product', 'wo_visita_observation'
  ));
