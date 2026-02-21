-- =============================================================================
-- Map "Elevador energizado e não usado (seg-sáb)" rule to all Moxuara elevator devices
--
-- Template rule  : bbbb0001-0001-0001-0001-000000000023
-- Customer       : Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
-- Tenant         : 11111111-1111-1111-1111-111111111111
-- Device filter  : UPPER(name) LIKE '%ELEVADOR%'
--
-- Idempotent: skips devices that already have this rule by name + scope.
-- =============================================================================

-- Preview devices that will be targeted (run first to verify)
SELECT d.id, d.name, d.asset_id
FROM devices d
WHERE d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
  AND d.tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND UPPER(d.name) LIKE '%ELEVADOR%'
ORDER BY d.name;

-- =============================================================================
-- INSERT one DEVICE-scoped rule per elevator device
-- (copies alarm_config, name, description, type, priority from the template rule)
-- =============================================================================
INSERT INTO rules (
    id,
    tenant_id,
    customer_id,
    name,
    description,
    type,
    priority,
    scope_type,
    scope_entity_id,
    scope_inherited,
    alarm_config,
    notification_channels,
    tags,
    status,
    enabled,
    version
)
SELECT
    gen_random_uuid(),
    d.tenant_id,
    d.customer_id,
    tmpl.name,
    tmpl.description,
    tmpl.type,
    tmpl.priority,
    'DEVICE',
    d.id,
    false,
    tmpl.alarm_config,
    tmpl.notification_channels,
    tmpl.tags,
    'ACTIVE',
    true,
    1
FROM devices d
CROSS JOIN (
    SELECT name, description, type, priority, alarm_config, notification_channels, tags
    FROM rules
    WHERE id = 'bbbb0001-0001-0001-0001-000000000023'
) tmpl
WHERE d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
  AND d.tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND UPPER(d.name) LIKE '%ELEVADOR%'
  AND NOT EXISTS (
      -- Skip if this device already has a rule with this name
      SELECT 1 FROM rules x
      WHERE x.scope_type      = 'DEVICE'
        AND x.scope_entity_id = d.id
        AND x.name            = tmpl.name
        AND x.tenant_id       = d.tenant_id
  );

-- =============================================================================
-- Verify: list all rules created for Moxuara elevator devices
-- =============================================================================
SELECT r.id, r.name, r.scope_type, r.scope_entity_id, d.name AS device_name
FROM rules r
JOIN devices d ON d.id = r.scope_entity_id
WHERE r.tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND r.scope_type  = 'DEVICE'
  AND r.name        = 'Elevador energizado e não usado (seg-sáb)'
  AND d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
ORDER BY d.name;
