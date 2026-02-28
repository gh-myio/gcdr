-- Add scope_entity_overrides column to rules table
-- RFC-0018: Per-Device Rule Value Overrides
ALTER TABLE "rules" ADD COLUMN IF NOT EXISTS "scope_entity_overrides" jsonb;
