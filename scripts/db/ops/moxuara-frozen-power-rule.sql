-- =============================================================================
-- INSERT Rule: "Elevador OFFLINE - Potência Congelada - Todos os dias"
-- + Associate to all Moxuara elevator devices via scope_entity_ids
--
-- Customer       : Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
-- Tenant         : 11111111-1111-1111-1111-111111111111
-- Rule ID        : bbbb0001-0001-0001-0001-000000000026
-- Duration       : 12h 21min = 44460000 ms
-- Operator       : UNCHANGED (triggers when metric stays exactly the same)
-- =============================================================================

-- STEP 1: INSERT the rule scoped to Moxuara's elevator devices
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
    scope_inherited,
    alarm_config,
    notification_channels,
    tags,
    status,
    enabled,
    version
)
VALUES (
    'bbbb0001-0001-0001-0001-000000000026',
    '11111111-1111-1111-1111-111111111111',
    '84e0370e-636a-4741-9874-504b5e0b3577',   -- Moxuara
    'Elevador OFFLINE - Potência Congelada - Todos os dias',
    'Alerta quando a potência do elevador permanece exatamente igual por 12h21min — indica sensor congelado ou elevador offline',
    'ALARM_THRESHOLD',
    'HIGH',
    'DEVICE',
    (
        SELECT ARRAY_AGG(id)
        FROM devices
        WHERE customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
          AND tenant_id   = '11111111-1111-1111-1111-111111111111'
          AND UPPER(name) LIKE '%ELEVADOR%'
    ),
    false,
    '{"metric": "power", "operator": "UNCHANGED", "value": 0, "duration": 44460000, "aggregation": "LAST", "startAt": "00:00", "endAt": "23:59", "daysOfWeek": [0, 1, 2, 3, 4, 5, 6], "keyMulti": 1, "dedup": {"enabled": true, "ttlSeconds": 600}, "cooldown": {"enabled": true, "seconds": 300, "perChannel": false}, "hysteresisGuard": {"enabled": false, "windowSeconds": 180, "maxTransitions": 3}, "digest": {"enabled": false, "windowSeconds": 600, "threshold": 5}}',
    '[{"type": "EMAIL", "config": {"to": ["operacoes@moxuara.com.br"]}, "enabled": true}]',
    '["elevator", "power", "frozen", "offline", "unchanged"]',
    'ACTIVE',
    true,
    1
);

-- STEP 2: Verify rule created and devices associated
SELECT
    r.id,
    r.name,
    r.priority,
    array_length(r.scope_entity_ids, 1) AS devices_count,
    r.alarm_config->>'operator'  AS operator,
    r.alarm_config->>'duration'  AS duration_ms,
    r.alarm_config->>'metric'    AS metric
FROM rules r
WHERE r.id = 'bbbb0001-0001-0001-0001-000000000026';

-- STEP 3: List all elevator devices associated
SELECT d.id, d.name
FROM devices d
WHERE d.id = ANY(
    SELECT unnest(scope_entity_ids) FROM rules
    WHERE id = 'bbbb0001-0001-0001-0001-000000000026'
)
ORDER BY d.name;
