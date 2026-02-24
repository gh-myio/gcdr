-- =============================================================================
-- INSERT Rules: "Potência do Elevador energizado e não usado"
-- + Associate to all Moxuara elevator devices via scope_entity_ids
--
-- Customer       : Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
-- Tenant         : 11111111-1111-1111-1111-111111111111
-- Rule IDs       : bbbb0001-0001-0001-0001-000000000027 (seg-sáb)
--                  bbbb0001-0001-0001-0001-000000000028 (domingo)
-- Metric         : instantaneous_power
-- Operator       : LT 200 W
-- Duration       : 300000 ms (5 min)
-- Aggregation    : AVG
-- Elevators      : slave_id 182-188
-- =============================================================================

-- STEP 1: INSERT rule seg-sáb (10:00–22:00)
INSERT INTO rules (
    id, tenant_id, customer_id,
    name, description, type, priority,
    scope_type, scope_entity_ids, scope_inherited,
    alarm_config, notification_channels, tags,
    status, enabled, version
) VALUES (
    'bbbb0001-0001-0001-0001-000000000027',
    '11111111-1111-1111-1111-111111111111',
    '84e0370e-636a-4741-9874-504b5e0b3577',
    'Potência do Elevador energizado e não usado (seg-sáb)',
    'Alerta quando a potência instantânea do elevador fica abaixo de 200W durante 5min em horário de operação — indica elevador energizado mas sem uso',
    'ALARM_THRESHOLD',
    'MEDIUM',
    'DEVICE',
    (SELECT ARRAY_AGG(id) FROM devices
     WHERE customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
       AND tenant_id   = '11111111-1111-1111-1111-111111111111'
       AND slave_id BETWEEN 182 AND 188),
    false,
    '{"metric": "instantaneous_power", "operator": "LT", "value": 200, "duration": 300000, "aggregation": "AVG", "startAt": "10:00", "endAt": "22:00", "daysOfWeek": [1, 2, 3, 4, 5, 6], "keyMulti": 1, "hysteresis": 0, "dedup": {"enabled": true, "ttlSeconds": 600}, "cooldown": {"enabled": true, "seconds": 300, "perChannel": false}, "hysteresisGuard": {"enabled": false, "windowSeconds": 180, "maxTransitions": 3}, "digest": {"enabled": false, "windowSeconds": 600, "threshold": 5}}',
    '[{"type": "EMAIL", "config": {"to": ["operacoes@moxuara.com.br"]}, "enabled": true}]',
    '["elevator", "power", "unused", "instantaneous_power"]',
    'ACTIVE', true, 1
);

-- STEP 2: INSERT rule domingo (12:00–22:00)
INSERT INTO rules (
    id, tenant_id, customer_id,
    name, description, type, priority,
    scope_type, scope_entity_ids, scope_inherited,
    alarm_config, notification_channels, tags,
    status, enabled, version
) VALUES (
    'bbbb0001-0001-0001-0001-000000000028',
    '11111111-1111-1111-1111-111111111111',
    '84e0370e-636a-4741-9874-504b5e0b3577',
    'Potência do Elevador energizado e não usado (domingo)',
    'Alerta quando a potência instantânea do elevador fica abaixo de 200W durante 5min em horário de operação aos domingos — indica elevador energizado mas sem uso',
    'ALARM_THRESHOLD',
    'MEDIUM',
    'DEVICE',
    (SELECT ARRAY_AGG(id) FROM devices
     WHERE customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
       AND tenant_id   = '11111111-1111-1111-1111-111111111111'
       AND slave_id BETWEEN 182 AND 188),
    false,
    '{"metric": "instantaneous_power", "operator": "LT", "value": 200, "duration": 300000, "aggregation": "AVG", "startAt": "12:00", "endAt": "22:00", "daysOfWeek": [0], "keyMulti": 1, "hysteresis": 0, "dedup": {"enabled": true, "ttlSeconds": 600}, "cooldown": {"enabled": true, "seconds": 300, "perChannel": false}, "hysteresisGuard": {"enabled": false, "windowSeconds": 180, "maxTransitions": 3}, "digest": {"enabled": false, "windowSeconds": 600, "threshold": 5}}',
    '[{"type": "EMAIL", "config": {"to": ["operacoes@moxuara.com.br"]}, "enabled": true}]',
    '["elevator", "power", "unused", "instantaneous_power"]',
    'ACTIVE', true, 1
);

-- STEP 3: Verify
SELECT
    id,
    name,
    array_length(scope_entity_ids, 1) AS devices_count,
    alarm_config->>'metric'      AS metric,
    alarm_config->>'operator'    AS operator,
    alarm_config->>'value'       AS value_w,
    alarm_config->>'duration'    AS duration_ms,
    alarm_config->>'startAt'     AS start_at,
    alarm_config->>'endAt'       AS end_at,
    alarm_config->>'daysOfWeek'  AS days
FROM rules
WHERE id IN (
    'bbbb0001-0001-0001-0001-000000000027',
    'bbbb0001-0001-0001-0001-000000000028'
);
