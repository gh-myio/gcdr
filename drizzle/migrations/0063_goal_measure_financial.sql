-- Migration 0063: RFC-0054 (rev. 3) — Phase 3: financial (CURRENCY) goals.
--
-- Adds `measure` (QUANTITY | CURRENCY) to the goal identity so a customer can
-- hold a kWh goal AND a R$ budget for the same (domain, year). This is the
-- blast-radius migration the RFC deliberately isolates from Phase 1 (0062):
-- it recreates `consumption_goals_uq` to include `measure`, and every goal
-- upsert/history lookup becomes measure-aware in code.
--
-- Existing rows default to QUANTITY, so the uniqueness key is unchanged for
-- them and all pre-0063 goal reads/writes stay byte-identical.
--
-- Companion: docs/rfcs/RFC-0054-Monetary-Goals-and-Customer-Tariffs.md (DEC-4/11)
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

-- 1) measure on the goal header (default QUANTITY = existing behavior).
ALTER TABLE "consumption_goals"
  ADD COLUMN IF NOT EXISTS "measure" text NOT NULL DEFAULT 'QUANTITY';

ALTER TABLE "consumption_goals" DROP CONSTRAINT IF EXISTS "consumption_goals_measure_check";
ALTER TABLE "consumption_goals" ADD CONSTRAINT "consumption_goals_measure_check"
  CHECK ("measure" IN ('QUANTITY', 'CURRENCY'));

-- 2) Recreate the uniqueness to include measure. 0047 may have created it as a
-- CONSTRAINT (a bare DROP INDEX fails 2BP01) or as a plain index — drop whichever.
ALTER TABLE "consumption_goals" DROP CONSTRAINT IF EXISTS "consumption_goals_uq";
DROP INDEX IF EXISTS "consumption_goals_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "consumption_goals_uq"
  ON "consumption_goals" ("tenant_id", "customer_id", "domain", "year", "measure");

-- 3) measure on the history stable key (nullable + backfill 'QUANTITY'), and
-- recreate the key index to include it so the two measures keep separate audit
-- streams.
ALTER TABLE "consumption_goal_history"
  ADD COLUMN IF NOT EXISTS "measure" text;
UPDATE "consumption_goal_history" SET "measure" = 'QUANTITY' WHERE "measure" IS NULL;

DROP INDEX IF EXISTS "consumption_goal_history_key_idx";
CREATE INDEX IF NOT EXISTS "consumption_goal_history_key_idx"
  ON "consumption_goal_history" ("tenant_id", "customer_id", "domain", "year", "measure", "changed_at" DESC);
