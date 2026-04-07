-- =============================================================================
-- OPS: Myio — Group Dispatch Config (Telegram)
-- =============================================================================
-- Tenant  : 11111111-1111-1111-1111-111111111111
-- Customer: 56614a70-326f-11ef-ad2c-53aeabe7d3fa (Myio)
-- Group   : 945acbfb-9b96-4073-9555-c0f61a4860be (Grupo Interno MYIO Alarmes)
-- =============================================================================

INSERT INTO group_dispatch_configs (id, tenant_id, group_id, channel, action, active, escalation_delay_ms)
VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '945acbfb-9b96-4073-9555-c0f61a4860be', 'TELEGRAM', 'OPEN',     true, 0),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '945acbfb-9b96-4073-9555-c0f61a4860be', 'TELEGRAM', 'CLOSE',    true, 0),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '945acbfb-9b96-4073-9555-c0f61a4860be', 'TELEGRAM', 'ESCALATE', true, 5000)
ON CONFLICT (tenant_id, group_id, channel, action) DO UPDATE
  SET active              = EXCLUDED.active,
      escalation_delay_ms = EXCLUDED.escalation_delay_ms,
      updated_at          = now();

-- Verify
SELECT channel, action, active, escalation_delay_ms
FROM group_dispatch_configs
WHERE group_id = '945acbfb-9b96-4073-9555-c0f61a4860be'
ORDER BY channel, action;

--- Results:
3 rows (81ms)
channel	action	active	escalation_delay_ms
TELEGRAM	OPEN	true	0
TELEGRAM	ESCALATE	true	5000
TELEGRAM	CLOSE	true	0

