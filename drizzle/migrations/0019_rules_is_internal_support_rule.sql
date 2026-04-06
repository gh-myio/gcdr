-- Migration 0019: add is_internal_support_rule to rules
-- Pass includeInternalSupportRule=false to exclude them from endpoints.

ALTER TABLE "rules"
  ADD COLUMN IF NOT EXISTS "is_internal_support_rule" boolean NOT NULL DEFAULT false;

-- Fix default if column already existed with DEFAULT true
ALTER TABLE "rules"
  ALTER COLUMN "is_internal_support_rule" SET DEFAULT false;

-- Reset all existing rows to false
UPDATE "rules" SET "is_internal_support_rule" = false;
