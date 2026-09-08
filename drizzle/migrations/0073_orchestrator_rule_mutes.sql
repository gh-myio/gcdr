-- RFC-0062 Monitor D (rules-monitor) — durable auto-mute ledger for NO_CONSUMPTION rules.
-- One row per device auto-muted from a rule for a tenant-local day. Audit trail + restore
-- source of truth: the monitor restores ONLY rows it wrote (restored_at IS NULL, older than
-- today); a human's manual scope edit is never here and never undone. NOT pruned.
-- Idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS orchestrator_rule_mutes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  customer_id  uuid,
  rule_id      uuid NOT NULL,
  device_id    uuid NOT NULL,
  local_day    date NOT NULL,
  today_count  integer NOT NULL,
  max_daily    integer NOT NULL,
  reason       varchar(40),
  mode         varchar(20),
  muted_at     timestamptz NOT NULL DEFAULT now(),
  restored_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- At most one auto-mute per (rule, device, local day) — idempotent re-ticks.
CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_rule_mutes_rule_device_day_unique
  ON orchestrator_rule_mutes (rule_id, device_id, local_day);
-- Find still-active mutes to restore at the day rollover.
CREATE INDEX IF NOT EXISTS orchestrator_rule_mutes_active_idx
  ON orchestrator_rule_mutes (restored_at, local_day);
CREATE INDEX IF NOT EXISTS orchestrator_rule_mutes_tenant_idx
  ON orchestrator_rule_mutes (tenant_id, created_at);
