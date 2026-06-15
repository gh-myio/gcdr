-- Migration 0041: work_orders_lifecycle_rules.is_terminal (RFC-0041)
--
-- Per-rule "closing" flag. A node marked terminal closes the WO: once its event
-- fires, no further lifecycle events are allowed. Lets a tenant define its own
-- terminal states instead of the hardcoded FINALIZADA/CANCELADA. When no rule
-- in a tenant's flow is terminal, the engine falls back to those two statuses.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

ALTER TABLE "work_orders_lifecycle_rules"
  ADD COLUMN IF NOT EXISTS "is_terminal" boolean NOT NULL DEFAULT false;
