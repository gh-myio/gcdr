-- Migration 0019: add is_internal_support_rule to rules
-- Internal support rules are included by default in all endpoints.
-- Pass includeInternalSupportRule=false to exclude them.

ALTER TABLE "rules"
  ADD COLUMN IF NOT EXISTS "is_internal_support_rule" boolean NOT NULL DEFAULT true;
