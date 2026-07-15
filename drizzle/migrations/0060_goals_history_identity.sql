-- Migration 0060: RFC-0046 feedback P1.5 — stable goal identity on history.
--
-- consumption_goal_history.goal_id has no FK (by design), so a whole-year
-- DELETE used to orphan the audit rows: the parent goal row disappears and
-- nothing can find them again. This migration duplicates the goal's natural
-- key (tenant, customer, domain, year) onto every history row so:
--   1. the trail of a deleted year stays reachable (GET with fetchHistory
--      now queries by key, not goal_id);
--   2. a delete/recreate of the same (customer, domain, year) reads as ONE
--      auditable stream across goal_id generations.
--
-- Columns stay nullable: rows already orphaned before this migration cannot
-- be backfilled (their parent is gone) and remain invisible, as before.
--
-- Companion: docs/rfcs/RFC-0046-Addendum-A-Device-Granular-Goals-feedback-v1.md (§P1.5)
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

ALTER TABLE "consumption_goal_history"
  ADD COLUMN IF NOT EXISTS "tenant_id"   uuid,
  ADD COLUMN IF NOT EXISTS "customer_id" uuid,
  ADD COLUMN IF NOT EXISTS "domain"      text,
  ADD COLUMN IF NOT EXISTS "year"        integer;

-- Backfill from the surviving parents.
UPDATE "consumption_goal_history" h
SET "tenant_id"   = g."tenant_id",
    "customer_id" = g."customer_id",
    "domain"      = g."domain",
    "year"        = g."year"
FROM "consumption_goals" g
WHERE h."goal_id" = g."id"
  AND h."tenant_id" IS NULL;

CREATE INDEX IF NOT EXISTS "consumption_goal_history_key_idx"
  ON "consumption_goal_history" ("tenant_id", "customer_id", "domain", "year", "changed_at" DESC);
