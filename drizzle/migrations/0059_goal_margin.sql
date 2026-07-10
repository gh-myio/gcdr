-- Migration 0059: RFC-0052 — Goal Margin Adjustment ("Margem da meta").
--
-- One signed percentage per (customer x domain x year) layered on top of the
-- RFC-0046 goal tree, e.g. Moxuara x ENERGY x 2026 = -5%. Read-time overlay:
-- the hourly buckets stay untouched; the API derives
--   adjustedValue = value * (1 + goal_margin_pct / 100)
-- on every tree node. The margin's identity is exactly consumption_goals'
-- uniqueness, so it lives as columns on the aggregate root — no new table.
--
-- History reuses consumption_goal_history with a new source 'MARGIN'
-- (old pct -> new pct, actor, timestamp); a margin write bumps the same
-- optimistic `version` as bucket writes.
--
-- Companion: docs/rfcs/RFC-0052-Goal-Margin-Adjustment.md
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

ALTER TABLE "consumption_goals"
  ADD COLUMN IF NOT EXISTS "goal_margin_pct"        numeric(6,2),
  ADD COLUMN IF NOT EXISTS "goal_margin_updated_by" uuid,
  ADD COLUMN IF NOT EXISTS "goal_margin_updated_at" timestamptz;

ALTER TABLE "consumption_goals"
  DROP CONSTRAINT IF EXISTS "consumption_goals_margin_range_check";
ALTER TABLE "consumption_goals"
  ADD CONSTRAINT "consumption_goals_margin_range_check"
  CHECK ("goal_margin_pct" IS NULL
     OR ("goal_margin_pct" >= -100 AND "goal_margin_pct" <= 100));

-- History source gains 'MARGIN'.
ALTER TABLE "consumption_goal_history"
  DROP CONSTRAINT IF EXISTS "consumption_goal_history_source_check";
ALTER TABLE "consumption_goal_history"
  ADD CONSTRAINT "consumption_goal_history_source_check"
  CHECK ("source" IN ('IMPORT','REPLACE','MERGE','DELETE','EDIT','MARGIN'));
