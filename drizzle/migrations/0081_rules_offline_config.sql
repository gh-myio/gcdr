-- Per-rule connectivity-offline config for DEVICE_OFFLINE / CENTRAL_OFFLINE rules:
-- offline_config jsonb holds { "offlineMinutes": N } — how long the device/central
-- must be OFFLINE before the rule fires. The condition is status-based (OFFLINE),
-- not a numeric metric threshold. Additive and idempotent; existing rows get NULL.
ALTER TABLE rules ADD COLUMN IF NOT EXISTS offline_config jsonb;
