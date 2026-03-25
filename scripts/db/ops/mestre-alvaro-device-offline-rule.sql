-- =============================================================================
-- OPS: Mestre Álvaro — Device Offline Rules (internal) — 3 centrais
-- =============================================================================
-- Customer : Mestre Álvaro (e04046d4-baa4-44e9-a378-4dfebe4140f1)
-- Tenant   : 11111111-1111-1111-1111-111111111111
-- Centrais :
--   Central 1: 45250d44-bad0-4071-aaa0-8091cfb12691
--   Central 2: d3202744-05dd-46d1-af33-495e9a2ecd52
--   Central 3: fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e
--
-- One rule per central — orchestrator matches heartbeat central_id to rule.
-- This is an INTERNAL rule:
--   • NOT sent via GET /alarm-rules/bundle/simple
--   • Consumed exclusively by the alarm orchestrator
--   • Orchestrator receives heartbeat payload { central_id, slaves: { slaveId: status } }
--     and queries GCDR for:
--       1. GET /devices?centralId=<central_id>  → slaveId → device mapping
--       2. GET /customers/<customerId>/rules     → filter type=DEVICE_OFFLINE, internalRule=true
--
-- Schedule: every day, 00:00–23:59 (no blackout window)
-- Requires: migration add-device-offline-rule-type.sql must be applied first
-- =============================================================================

DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := 'e04046d4-baa4-44e9-a378-4dfebe4140f1';
  v_centrals    UUID[] := ARRAY[
    '45250d44-bad0-4071-aaa0-8091cfb12691'::uuid,
    'd3202744-05dd-46d1-af33-495e9a2ecd52'::uuid,
    'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e'::uuid
  ];
  v_central_id  UUID;
  v_rule_id     UUID;
  v_idx         INT := 1;
BEGIN

  FOREACH v_central_id IN ARRAY v_centrals LOOP

    -- Guard: avoid duplicate per central
    IF EXISTS (
      SELECT 1 FROM rules
      WHERE tenant_id   = v_tenant_id
        AND customer_id = v_customer_id
        AND type        = 'DEVICE_OFFLINE'
        AND internal_rule = TRUE
        AND alarm_config->>'centralId' = v_central_id::text
    ) THEN
      RAISE NOTICE 'Device Offline rule already exists for Mestre Álvaro central % — skipping.', v_central_id;
      v_idx := v_idx + 1;
      CONTINUE;
    END IF;

    v_rule_id := gen_random_uuid();

    INSERT INTO rules (
      id,
      tenant_id,
      customer_id,
      name,
      description,
      type,
      priority,
      scope_type,
      scope_entity_ids,
      alarm_config,
      notification_channels,
      tags,
      status,
      enabled,
      internal_rule,
      version,
      created_at,
      updated_at
    )
    VALUES (
      v_rule_id,
      v_tenant_id,
      v_customer_id,

      'Device Offline — Mestre Álvaro (Central ' || v_idx || ')',
      'Internal rule for device connectivity monitoring via central gateway heartbeat. '
      || 'The alarm orchestrator evaluates slave status from heartbeat payloads and '
      || 'opens/closes alarms based on this rule config.',

      'DEVICE_OFFLINE',
      'HIGH',

      -- Scope: customer-wide (orchestrator resolves individual devices via /devices?centralId=...)
      'CUSTOMER',
      ARRAY[]::uuid[],

      -- alarmConfig stores the schedule + central reference for orchestrator lookup
      jsonb_build_object(
        'metric',      'connectivity',
        'operator',    'EQ',
        'value',       0,
        'startAt',     '00:00',
        'endAt',       '23:59',
        'daysOfWeek',  jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
        'centralId',   v_central_id,

        -- cooldown: don't re-open the same slave alarm within 5 min of last open
        'cooldown', jsonb_build_object(
          'enabled',    true,
          'seconds',    300,
          'perChannel', false
        ),

        -- dedup: suppress duplicate offline events in a 5-minute window
        'dedup', jsonb_build_object(
          'enabled',    true,
          'ttlSeconds', 300
        )
      ),

      '[]'::jsonb,  -- notificationChannels (managed by orchestrator dispatch)

      '["device-offline", "internal", "mestre-alvaro", "connectivity"]'::jsonb,

      'ACTIVE',
      TRUE,   -- enabled
      TRUE,   -- internal_rule → excluded from /simple bundle

      1,
      NOW(),
      NOW()
    );

    RAISE NOTICE 'Device Offline rule created for Mestre Álvaro central %: rule_id = %', v_central_id, v_rule_id;
    v_idx := v_idx + 1;

  END LOOP;
END $$;

-- =============================================================================
-- Verify
-- =============================================================================
SELECT
  id,
  name,
  type,
  priority,
  scope_type,
  enabled,
  internal_rule,
  alarm_config->>'centralId'   AS central_id,
  alarm_config->>'startAt'     AS start_at,
  alarm_config->>'endAt'       AS end_at,
  alarm_config->'daysOfWeek'   AS days_of_week
FROM rules
WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
  AND type        = 'DEVICE_OFFLINE'
ORDER BY name;
