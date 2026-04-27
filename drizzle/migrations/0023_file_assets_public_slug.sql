-- Migration 0023: file_assets.public_slug
--
-- Adds an optional human-readable slug to file_assets so consumers can
-- reference files via stable, brand-friendly URLs:
--   GET /api/v1/public/files/by-slug/<slug>
-- instead of the raw S3 signed URL with UUIDs and content hashes.
--
-- The slug is unique per tenant (and only among non-deleted rows). New rows
-- can omit it (NULL) — the legacy by-id flow keeps working unchanged.

ALTER TABLE "file_assets"
  ADD COLUMN "public_slug" text;

ALTER TABLE "file_assets"
  ADD CONSTRAINT "file_assets_public_slug_shape"
  CHECK ("public_slug" IS NULL OR "public_slug" ~ '^[a-z0-9][a-z0-9/_-]{0,127}$');

-- Unique-when-set: two ACTIVE rows in the same tenant cannot share a slug.
-- Soft-deleted rows are excluded so the slug can be reassigned to a new asset
-- after the previous holder is deleted.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_file_assets_tenant_public_slug"
  ON "file_assets" ("tenant_id", "public_slug")
  WHERE "public_slug" IS NOT NULL AND "deleted_at" IS NULL;
