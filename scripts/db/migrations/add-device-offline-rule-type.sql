-- =============================================================================
-- Migration: add DEVICE_OFFLINE rule type + internal_rule flag
-- =============================================================================
-- Adds:
--   1. DEVICE_OFFLINE value to rule_type enum
--   2. internal_rule boolean column to rules table
--      → rules with internal_rule = true are excluded from /alarm-rules/bundle/simple
-- =============================================================================

-- Step 1: extend the enum
ALTER TYPE rule_type ADD VALUE IF NOT EXISTS 'DEVICE_OFFLINE';

-- Step 2: add the flag column
ALTER TABLE rules
  ADD COLUMN IF NOT EXISTS internal_rule BOOLEAN NOT NULL DEFAULT FALSE;

-- Index: orchestrator queries rules by type + internal_rule flag
CREATE INDEX IF NOT EXISTS rules_internal_rule_idx
  ON rules (tenant_id, customer_id, internal_rule)
  WHERE internal_rule = TRUE;

-- Verify
SELECT
  typname,
  enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE typname = 'rule_type'
ORDER BY enumsortorder;

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'rules' AND column_name = 'internal_rule';
