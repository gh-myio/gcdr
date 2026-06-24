-- Migration 0049: central_backups — registry of PostgreSQL/TimescaleDB dumps
-- taken FROM each central. The CENTRAL runs pg_dump (custom format) on its own
-- embedded Postgres; gcdr only BROKERS a presigned S3 URL and tracks metadata.
-- The dump bytes never touch gcdr (central PUTs to presigned URL, later GETs
-- for download/restore via presigned URL).
--
-- Lifecycle: a row is created PENDING when a backup is requested (presigned PUT
-- handed out); the central uploads and then confirms (sha256 + byte_size) and
-- the row flips to AVAILABLE. Foundation for the field-swap restore — Phase 2
-- adds central_restore_jobs + the previous_central_id identity hand-off.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

CREATE TYPE "central_backup_status" AS ENUM ('PENDING', 'AVAILABLE', 'EXPIRED', 'FAILED');

CREATE TABLE "central_backups" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL,
  "central_id"   uuid NOT NULL REFERENCES "centrals"("id"),
  "storage_key"  text NOT NULL,
  "bucket"       varchar(255) NOT NULL,
  "content_type" varchar(127) NOT NULL DEFAULT 'application/octet-stream',
  "sha256"       varchar(64),
  "byte_size"    bigint,
  "status"       "central_backup_status" NOT NULL DEFAULT 'PENDING',
  "source_label" varchar(32),
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz,
  "created_by"   uuid,
  "version"      integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX "central_backups_storage_key_unique" ON "central_backups" ("storage_key");
CREATE INDEX "central_backups_tenant_central_idx" ON "central_backups" ("tenant_id", "central_id", "created_at" DESC);
CREATE INDEX "central_backups_tenant_status_idx" ON "central_backups" ("tenant_id", "status");
