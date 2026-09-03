-- RFC-0062 — durable per-central connectivity timeline.
-- Append-ON-CHANGE (one row per ONLINE/DEGRADED/OFFLINE/UNKNOWN transition), NOT pruned
-- by the worker's ledger prune, so the timeline survives long-term. In shadow mode the
-- worker records the PROPOSED state trajectory. Idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS orchestrator_devices_status_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  customer_id  uuid,
  entity_type  varchar(20) NOT NULL DEFAULT 'central',
  entity_id    uuid NOT NULL,
  central_id   uuid,
  from_status  varchar(30),
  to_status    varchar(30) NOT NULL,
  probe_result varchar(30),
  mode         varchar(20),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orchestrator_devices_status_history_central_idx
  ON orchestrator_devices_status_history (central_id, created_at);
CREATE INDEX IF NOT EXISTS orchestrator_devices_status_history_tenant_idx
  ON orchestrator_devices_status_history (tenant_id, created_at);
