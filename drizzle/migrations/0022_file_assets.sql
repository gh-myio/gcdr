-- Migration 0022: Generic file/asset storage for the platform
--
-- Provides a single place where ANY GCDR feature can register a file stored
-- in S3 (or MinIO in dev). Polymorphic via (owner_type, owner_id) so the same
-- table backs wiki page attachments, wiki PDF renders, future avatars,
-- customer logos, device manuals, etc. without per-feature tables.
--
-- Naming: the term "assets" is already used in the IoT hierarchy (SITE >
-- BUILDING > FLOOR > EQUIPMENT). To avoid collision, this table is
-- `file_assets` and the corresponding TS entity is `FileAsset`.
--
-- Storage layout (per RFC-0030-S3-Bucket-Setup):
--   <bucket>/assets/<tenant_id>/<yyyy>/<mm>/<file_asset_id>/<sha256>.<ext>

CREATE TABLE IF NOT EXISTS "file_assets" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"         uuid        NOT NULL,
  "customer_id"       uuid,                                  -- optional scope

  -- Polymorphic owner — `free` means uploaded but not yet attached to anything.
  -- New owner types can be added by ALTER ... DROP CONSTRAINT + new CHECK,
  -- never by abandoning this table.
  "owner_type"        text        NOT NULL,
  "owner_id"          text,                                  -- nullable for `free`

  -- File metadata
  "filename"          text        NOT NULL,
  "content_type"      text        NOT NULL,
  "byte_size"         bigint      NOT NULL,
  "sha256"            text        NOT NULL,                  -- hex SHA-256 of content

  -- Storage backend
  "storage_provider"  text        NOT NULL DEFAULT 'S3',
  "storage_bucket"    text        NOT NULL,
  "storage_key"       text        NOT NULL,                  -- full key inside bucket

  -- Lifecycle
  "status"            text        NOT NULL DEFAULT 'ACTIVE',
  "scan_status"       text        NOT NULL DEFAULT 'PENDING',-- AV scan slot

  -- Audit
  "uploaded_by"       uuid        NOT NULL,
  "uploaded_at"       timestamptz NOT NULL DEFAULT now(),
  "deleted_at"        timestamptz,

  -- Extension point — image dimensions, video duration, exif, etc.
  "metadata"          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT "file_assets_owner_type_check"
    CHECK ("owner_type" IN ('wiki_page','wiki_pdf','free')),
  CONSTRAINT "file_assets_status_check"
    CHECK ("status" IN ('PENDING_UPLOAD','ACTIVE','QUARANTINED','DELETED')),
  CONSTRAINT "file_assets_scan_status_check"
    CHECK ("scan_status" IN ('PENDING','CLEAN','INFECTED','SKIPPED')),
  CONSTRAINT "file_assets_storage_provider_check"
    CHECK ("storage_provider" IN ('S3','MINIO','LOCAL')),
  CONSTRAINT "file_assets_byte_size_positive"
    CHECK ("byte_size" >= 0),
  CONSTRAINT "file_assets_filename_nonempty"
    CHECK (length("filename") > 0),
  CONSTRAINT "file_assets_storage_key_nonempty"
    CHECK (length("storage_key") > 0),
  CONSTRAINT "file_assets_sha256_format"
    CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "file_assets_owner_id_when_typed"
    CHECK ("owner_type" = 'free' OR "owner_id" IS NOT NULL)
);

-- Customer FK is optional — added without ON DELETE CASCADE because we want
-- file_assets to outlive customer deletion (audit, ownership disputes).
-- Application layer is responsible for deciding what to do on customer delete.
ALTER TABLE "file_assets"
  ADD CONSTRAINT "file_assets_customer_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id");

-- =============================================================================
-- Indexes
-- =============================================================================

-- Lookup: "find all assets owned by this thing"
CREATE INDEX IF NOT EXISTS "idx_file_assets_tenant_owner"
  ON "file_assets" ("tenant_id", "owner_type", "owner_id");

-- Default list endpoints filter out soft-deleted rows
CREATE INDEX IF NOT EXISTS "idx_file_assets_tenant_live"
  ON "file_assets" ("tenant_id")
  WHERE "deleted_at" IS NULL;

-- Dedup hint: same content uploaded twice within a tenant should be cheap to detect
CREATE INDEX IF NOT EXISTS "idx_file_assets_tenant_sha256"
  ON "file_assets" ("tenant_id", "sha256");

-- Status filter — scan-status sweep, quarantine queues, etc.
CREATE INDEX IF NOT EXISTS "idx_file_assets_tenant_status"
  ON "file_assets" ("tenant_id", "status")
  WHERE "status" <> 'DELETED';

-- Customer-scoped queries (e.g. "all files for this customer")
CREATE INDEX IF NOT EXISTS "idx_file_assets_tenant_customer"
  ON "file_assets" ("tenant_id", "customer_id")
  WHERE "customer_id" IS NOT NULL;
