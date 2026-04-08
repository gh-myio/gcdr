-- Migration: add lookback_days to rules
-- Adds an optional integer column that tells the alarm backend how many days
-- back to evaluate when processing this rule (used by periodic/scheduled rules).

ALTER TABLE rules
  ADD COLUMN IF NOT EXISTS lookback_days INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN rules.lookback_days IS
  'Number of days back the alarm backend should look when evaluating this rule. 0 = no lookback constraint (default).';
