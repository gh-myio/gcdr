-- =============================================================================
-- OPS: Supervia Estações — Device Offline Rules (internal)
-- =============================================================================
-- Parent  : Supervia Estações  (01c0179c-08d5-4bb8-9a3c-743327ac63d1)
-- Tenant  : 11111111-1111-1111-1111-111111111111
--
-- Customers / Centrals:
--   Supervia CASCADURA       25ca2e5c-7caa-4196-ba18-a973815cb2f4  → e6cda66f-9641-4669-8081-7349df8353c3
--   Supervia DEODORO         4fd8700d-7a86-438b-9d45-5c05b97b2a88  → adb43bf6-6107-44fa-b786-6e88c150d779
--   Supervia ENG. DE DENTRO  0193eac5-68ff-443b-baed-3cd61a5e6c37  → 0e8366f3-6a0c-478e-a486-fec481fe7448 (superior)
--                                                                     88eddfb5-e7f1-4f2b-83a0-2c8faf95505a (inferior)
--   Supervia MARACANÃ        46260fbb-89b6-4166-b81e-7bca0b0dc78e  → e5ce2467-4587-443b-b545-b294d8f58209
--   Supervia MÉIER           b718abd9-617a-4618-bdee-7154513224bf  → 0c3dae24-1b20-48ad-803b-5a2d207102b7
--
-- Notes:
--   • ENG. DE DENTRO has two centrals → two separate rules
--   • All rules are internal (excluded from /simple bundle)
--   • Requires: migration add-device-offline-rule-type.sql must be applied first
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Supervia CASCADURA
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := '25ca2e5c-7caa-4196-ba18-a973815cb2f4';
  v_central_id  UUID := 'e6cda66f-9641-4669-8081-7349df8353c3';
  v_rule_id     UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM rules
    WHERE tenant_id    = v_tenant_id
      AND customer_id  = v_customer_id
      AND type         = 'DEVICE_OFFLINE'
      AND internal_rule = TRUE
      AND alarm_config->>'centralId' = v_central_id::text
  ) THEN
    RAISE NOTICE 'Device Offline rule already exists for Supervia CASCADURA — skipping.';
    RETURN;
  END IF;

  v_rule_id := gen_random_uuid();

  INSERT INTO rules (
    id, tenant_id, customer_id, name, description, type, priority,
    scope_type, scope_entity_ids, alarm_config, notification_channels,
    tags, status, enabled, internal_rule, version, created_at, updated_at
  ) VALUES (
    v_rule_id,
    v_tenant_id,
    v_customer_id,
    'Device Offline — Supervia CASCADURA',
    'Internal rule for device connectivity monitoring via central gateway heartbeat. '
    || 'The alarm orchestrator evaluates slave status from heartbeat payloads and '
    || 'opens/closes alarms based on this rule config.',
    'DEVICE_OFFLINE',
    'HIGH',
    'CUSTOMER',
    ARRAY[]::uuid[],
    jsonb_build_object(
      'metric',     'connectivity',
      'operator',   'EQ',
      'value',      0,
      'startAt',    '00:00',
      'endAt',      '23:59',
      'daysOfWeek', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
      'centralId',  v_central_id,
      'cooldown', jsonb_build_object('enabled', true, 'seconds', 300, 'perChannel', false),
      'dedup',    jsonb_build_object('enabled', true, 'ttlSeconds', 300)
    ),
    '[]'::jsonb,
    '["device-offline", "internal", "supervia", "cascadura", "connectivity"]'::jsonb,
    'ACTIVE', TRUE, TRUE, 1, NOW(), NOW()
  );

  RAISE NOTICE 'Device Offline rule created for Supervia CASCADURA: id = %', v_rule_id;
END $$;

-- -----------------------------------------------------------------------------
-- Supervia DEODORO
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := '4fd8700d-7a86-438b-9d45-5c05b97b2a88';
  v_central_id  UUID := 'adb43bf6-6107-44fa-b786-6e88c150d779';
  v_rule_id     UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM rules
    WHERE tenant_id    = v_tenant_id
      AND customer_id  = v_customer_id
      AND type         = 'DEVICE_OFFLINE'
      AND internal_rule = TRUE
      AND alarm_config->>'centralId' = v_central_id::text
  ) THEN
    RAISE NOTICE 'Device Offline rule already exists for Supervia DEODORO — skipping.';
    RETURN;
  END IF;

  v_rule_id := gen_random_uuid();

  INSERT INTO rules (
    id, tenant_id, customer_id, name, description, type, priority,
    scope_type, scope_entity_ids, alarm_config, notification_channels,
    tags, status, enabled, internal_rule, version, created_at, updated_at
  ) VALUES (
    v_rule_id,
    v_tenant_id,
    v_customer_id,
    'Device Offline — Supervia DEODORO',
    'Internal rule for device connectivity monitoring via central gateway heartbeat. '
    || 'The alarm orchestrator evaluates slave status from heartbeat payloads and '
    || 'opens/closes alarms based on this rule config.',
    'DEVICE_OFFLINE',
    'HIGH',
    'CUSTOMER',
    ARRAY[]::uuid[],
    jsonb_build_object(
      'metric',     'connectivity',
      'operator',   'EQ',
      'value',      0,
      'startAt',    '00:00',
      'endAt',      '23:59',
      'daysOfWeek', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
      'centralId',  v_central_id,
      'cooldown', jsonb_build_object('enabled', true, 'seconds', 300, 'perChannel', false),
      'dedup',    jsonb_build_object('enabled', true, 'ttlSeconds', 300)
    ),
    '[]'::jsonb,
    '["device-offline", "internal", "supervia", "deodoro", "connectivity"]'::jsonb,
    'ACTIVE', TRUE, TRUE, 1, NOW(), NOW()
  );

  RAISE NOTICE 'Device Offline rule created for Supervia DEODORO: id = %', v_rule_id;
END $$;

-- -----------------------------------------------------------------------------
-- Supervia ENG. DE DENTRO — Central 1
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := '0193eac5-68ff-443b-baed-3cd61a5e6c37';
  v_central_id  UUID := '0e8366f3-6a0c-478e-a486-fec481fe7448'; -- superior
  v_rule_id     UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM rules
    WHERE tenant_id    = v_tenant_id
      AND customer_id  = v_customer_id
      AND type         = 'DEVICE_OFFLINE'
      AND internal_rule = TRUE
      AND alarm_config->>'centralId' = v_central_id::text
  ) THEN
    RAISE NOTICE 'Device Offline rule already exists for Supervia ENG. DE DENTRO (central 1) — skipping.';
    RETURN;
  END IF;

  v_rule_id := gen_random_uuid();

  INSERT INTO rules (
    id, tenant_id, customer_id, name, description, type, priority,
    scope_type, scope_entity_ids, alarm_config, notification_channels,
    tags, status, enabled, internal_rule, version, created_at, updated_at
  ) VALUES (
    v_rule_id,
    v_tenant_id,
    v_customer_id,
    'Device Offline — Supervia ENG. DE DENTRO (1)',
    'Internal rule for device connectivity monitoring via central gateway heartbeat. '
    || 'The alarm orchestrator evaluates slave status from heartbeat payloads and '
    || 'opens/closes alarms based on this rule config.',
    'DEVICE_OFFLINE',
    'HIGH',
    'CUSTOMER',
    ARRAY[]::uuid[],
    jsonb_build_object(
      'metric',     'connectivity',
      'operator',   'EQ',
      'value',      0,
      'startAt',    '00:00',
      'endAt',      '23:59',
      'daysOfWeek', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
      'centralId',  v_central_id,
      'cooldown', jsonb_build_object('enabled', true, 'seconds', 300, 'perChannel', false),
      'dedup',    jsonb_build_object('enabled', true, 'ttlSeconds', 300)
    ),
    '[]'::jsonb,
    '["device-offline", "internal", "supervia", "eng-de-dentro", "connectivity"]'::jsonb,
    'ACTIVE', TRUE, TRUE, 1, NOW(), NOW()
  );

  RAISE NOTICE 'Device Offline rule created for Supervia ENG. DE DENTRO (central 1): id = %', v_rule_id;
END $$;

-- -----------------------------------------------------------------------------
-- Supervia ENG. DE DENTRO — Central 2
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := '0193eac5-68ff-443b-baed-3cd61a5e6c37';
  v_central_id  UUID := '88eddfb5-e7f1-4f2b-83a0-2c8faf95505a'; -- inferior
  v_rule_id     UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM rules
    WHERE tenant_id    = v_tenant_id
      AND customer_id  = v_customer_id
      AND type         = 'DEVICE_OFFLINE'
      AND internal_rule = TRUE
      AND alarm_config->>'centralId' = v_central_id::text
  ) THEN
    RAISE NOTICE 'Device Offline rule already exists for Supervia ENG. DE DENTRO (central 2) — skipping.';
    RETURN;
  END IF;

  v_rule_id := gen_random_uuid();

  INSERT INTO rules (
    id, tenant_id, customer_id, name, description, type, priority,
    scope_type, scope_entity_ids, alarm_config, notification_channels,
    tags, status, enabled, internal_rule, version, created_at, updated_at
  ) VALUES (
    v_rule_id,
    v_tenant_id,
    v_customer_id,
    'Device Offline — Supervia ENG. DE DENTRO (2)',
    'Internal rule for device connectivity monitoring via central gateway heartbeat. '
    || 'The alarm orchestrator evaluates slave status from heartbeat payloads and '
    || 'opens/closes alarms based on this rule config.',
    'DEVICE_OFFLINE',
    'HIGH',
    'CUSTOMER',
    ARRAY[]::uuid[],
    jsonb_build_object(
      'metric',     'connectivity',
      'operator',   'EQ',
      'value',      0,
      'startAt',    '00:00',
      'endAt',      '23:59',
      'daysOfWeek', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
      'centralId',  v_central_id,
      'cooldown', jsonb_build_object('enabled', true, 'seconds', 300, 'perChannel', false),
      'dedup',    jsonb_build_object('enabled', true, 'ttlSeconds', 300)
    ),
    '[]'::jsonb,
    '["device-offline", "internal", "supervia", "eng-de-dentro", "connectivity"]'::jsonb,
    'ACTIVE', TRUE, TRUE, 1, NOW(), NOW()
  );

  RAISE NOTICE 'Device Offline rule created for Supervia ENG. DE DENTRO (central 2): id = %', v_rule_id;
END $$;

-- -----------------------------------------------------------------------------
-- Supervia MARACANÃ
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := '46260fbb-89b6-4166-b81e-7bca0b0dc78e';
  v_central_id  UUID := 'e5ce2467-4587-443b-b545-b294d8f58209';
  v_rule_id     UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM rules
    WHERE tenant_id    = v_tenant_id
      AND customer_id  = v_customer_id
      AND type         = 'DEVICE_OFFLINE'
      AND internal_rule = TRUE
      AND alarm_config->>'centralId' = v_central_id::text
  ) THEN
    RAISE NOTICE 'Device Offline rule already exists for Supervia MARACANÃ — skipping.';
    RETURN;
  END IF;

  v_rule_id := gen_random_uuid();

  INSERT INTO rules (
    id, tenant_id, customer_id, name, description, type, priority,
    scope_type, scope_entity_ids, alarm_config, notification_channels,
    tags, status, enabled, internal_rule, version, created_at, updated_at
  ) VALUES (
    v_rule_id,
    v_tenant_id,
    v_customer_id,
    'Device Offline — Supervia MARACANÃ',
    'Internal rule for device connectivity monitoring via central gateway heartbeat. '
    || 'The alarm orchestrator evaluates slave status from heartbeat payloads and '
    || 'opens/closes alarms based on this rule config.',
    'DEVICE_OFFLINE',
    'HIGH',
    'CUSTOMER',
    ARRAY[]::uuid[],
    jsonb_build_object(
      'metric',     'connectivity',
      'operator',   'EQ',
      'value',      0,
      'startAt',    '00:00',
      'endAt',      '23:59',
      'daysOfWeek', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
      'centralId',  v_central_id,
      'cooldown', jsonb_build_object('enabled', true, 'seconds', 300, 'perChannel', false),
      'dedup',    jsonb_build_object('enabled', true, 'ttlSeconds', 300)
    ),
    '[]'::jsonb,
    '["device-offline", "internal", "supervia", "maracana", "connectivity"]'::jsonb,
    'ACTIVE', TRUE, TRUE, 1, NOW(), NOW()
  );

  RAISE NOTICE 'Device Offline rule created for Supervia MARACANÃ: id = %', v_rule_id;
END $$;

-- -----------------------------------------------------------------------------
-- Supervia MÉIER
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := 'b718abd9-617a-4618-bdee-7154513224bf';
  v_central_id  UUID := '0c3dae24-1b20-48ad-803b-5a2d207102b7';
  v_rule_id     UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM rules
    WHERE tenant_id    = v_tenant_id
      AND customer_id  = v_customer_id
      AND type         = 'DEVICE_OFFLINE'
      AND internal_rule = TRUE
      AND alarm_config->>'centralId' = v_central_id::text
  ) THEN
    RAISE NOTICE 'Device Offline rule already exists for Supervia MÉIER — skipping.';
    RETURN;
  END IF;

  v_rule_id := gen_random_uuid();

  INSERT INTO rules (
    id, tenant_id, customer_id, name, description, type, priority,
    scope_type, scope_entity_ids, alarm_config, notification_channels,
    tags, status, enabled, internal_rule, version, created_at, updated_at
  ) VALUES (
    v_rule_id,
    v_tenant_id,
    v_customer_id,
    'Device Offline — Supervia MÉIER',
    'Internal rule for device connectivity monitoring via central gateway heartbeat. '
    || 'The alarm orchestrator evaluates slave status from heartbeat payloads and '
    || 'opens/closes alarms based on this rule config.',
    'DEVICE_OFFLINE',
    'HIGH',
    'CUSTOMER',
    ARRAY[]::uuid[],
    jsonb_build_object(
      'metric',     'connectivity',
      'operator',   'EQ',
      'value',      0,
      'startAt',    '00:00',
      'endAt',      '23:59',
      'daysOfWeek', jsonb_build_array(0, 1, 2, 3, 4, 5, 6),
      'centralId',  v_central_id,
      'cooldown', jsonb_build_object('enabled', true, 'seconds', 300, 'perChannel', false),
      'dedup',    jsonb_build_object('enabled', true, 'ttlSeconds', 300)
    ),
    '[]'::jsonb,
    '["device-offline", "internal", "supervia", "meier", "connectivity"]'::jsonb,
    'ACTIVE', TRUE, TRUE, 1, NOW(), NOW()
  );

  RAISE NOTICE 'Device Offline rule created for Supervia MÉIER: id = %', v_rule_id;
END $$;

-- =============================================================================
-- Verify — all 6 rules
-- =============================================================================
SELECT
  c.name                           AS customer,
  r.id,
  r.name,
  r.type,
  r.priority,
  r.enabled,
  r.internal_rule,
  r.alarm_config->>'centralId'     AS central_id
FROM rules r
JOIN customers c ON c.id = r.customer_id
WHERE r.customer_id IN (
  '25ca2e5c-7caa-4196-ba18-a973815cb2f4',  -- CASCADURA
  '4fd8700d-7a86-438b-9d45-5c05b97b2a88',  -- DEODORO
  '0193eac5-68ff-443b-baed-3cd61a5e6c37',  -- ENG. DE DENTRO
  '46260fbb-89b6-4166-b81e-7bca0b0dc78e',  -- MARACANÃ
  'b718abd9-617a-4618-bdee-7154513224bf'   -- MÉIER
)
  AND r.type = 'DEVICE_OFFLINE'
ORDER BY c.name, r.alarm_config->>'centralId';
