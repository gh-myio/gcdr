-- =============================================================================
-- SEED: GROUPS
-- =============================================================================
-- Mock data for groups table
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
BEGIN
    -- Operations Team Group
    INSERT INTO groups (id, tenant_id, customer_id, name, display_name, description, code, type, purposes, members, member_count, notification_settings, tags, metadata, visible_to_child_customers, editable_by_child_customers, status, version)
    VALUES (
        'eee00001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_company1_id,
        'Operations Team',
        'Equipe de Operações',
        'Team responsible for daily operations and monitoring',
        'OPS-TEAM',
        'USER',
        '["NOTIFICATION", "ESCALATION", "REPORTING"]',
        '[{"entityId": "bbbb2222-2222-2222-2222-222222222222", "entityType": "user", "role": "leader", "addedAt": "2024-01-01T00:00:00Z"}, {"entityId": "bbbb3333-3333-3333-3333-333333333333", "entityType": "user", "role": "member", "addedAt": "2024-01-15T00:00:00Z"}]',
        2,
        '{"email": {"enabled": true, "frequency": "immediate"}, "sms": {"enabled": true, "frequency": "critical-only"}, "push": {"enabled": true}}',
        '["operations", "team"]',
        '{"department": "Operations", "costCenter": "CC-001"}',
        true,
        false,
        'ACTIVE',
        1
    );

    -- Server Room Devices Group
    INSERT INTO groups (id, tenant_id, customer_id, name, display_name, description, code, type, purposes, members, member_count, notification_settings, tags, metadata, visible_to_child_customers, editable_by_child_customers, status, version)
    VALUES (
        'eee00001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_company1_id,
        'Server Room Devices',
        'Dispositivos Sala de Servidores',
        'All devices located in the server room',
        'SRV-DEVICES',
        'DEVICE',
        '["MONITORING", "MAINTENANCE"]',
        '[{"entityId": "11110001-0001-0001-0001-000000000001", "entityType": "device", "addedAt": "2024-01-01T00:00:00Z"}, {"entityId": "11110001-0001-0001-0001-000000000002", "entityType": "device", "addedAt": "2024-01-01T00:00:00Z"}, {"entityId": "11110001-0001-0001-0001-000000000003", "entityType": "device", "addedAt": "2024-01-01T00:00:00Z"}, {"entityId": "11110001-0001-0001-0001-000000000006", "entityType": "device", "addedAt": "2024-01-01T00:00:00Z"}]',
        4,
        '{"email": {"enabled": true}}',
        '["devices", "server-room"]',
        '{"location": "Server Room", "criticality": "high"}',
        true,
        true,
        'ACTIVE',
        1
    );

    -- Critical Assets Group
    INSERT INTO groups (id, tenant_id, customer_id, name, display_name, description, code, type, purposes, members, member_count, notification_settings, tags, metadata, visible_to_child_customers, editable_by_child_customers, status, version)
    VALUES (
        'eee00001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_company1_id,
        'Critical Assets',
        'Ativos Críticos',
        'Critical infrastructure assets requiring special monitoring',
        'CRITICAL-ASSETS',
        'ASSET',
        '["MONITORING", "SLA", "REPORTING"]',
        '[{"entityId": "ffff4444-4444-4444-4444-444444444444", "entityType": "asset", "addedAt": "2024-01-01T00:00:00Z"}, {"entityId": "ffff6666-6666-6666-6666-666666666666", "entityType": "asset", "addedAt": "2024-01-01T00:00:00Z"}]',
        2,
        '{"email": {"enabled": true, "frequency": "immediate"}}',
        '["critical", "infrastructure"]',
        '{"slaLevel": "platinum"}',
        false,
        false,
        'ACTIVE',
        1
    );

    -- Mixed Notification Group
    INSERT INTO groups (id, tenant_id, customer_id, name, display_name, description, code, type, purposes, members, member_count, notification_settings, tags, metadata, visible_to_child_customers, editable_by_child_customers, status, version)
    VALUES (
        'eee00001-0001-0001-0001-000000000004',
        v_tenant_id,
        v_company1_id,
        'Alert Recipients',
        'Destinatários de Alertas',
        'Mixed group for alert notifications',
        'ALERT-RECIPIENTS',
        'MIXED',
        '["NOTIFICATION", "ESCALATION"]',
        '[{"entityId": "bbbb2222-2222-2222-2222-222222222222", "entityType": "user", "addedAt": "2024-01-01T00:00:00Z"}, {"entityId": "eee00001-0001-0001-0001-000000000001", "entityType": "group", "addedAt": "2024-01-10T00:00:00Z"}]',
        2,
        '{"email": {"enabled": true}, "slack": {"enabled": true, "channel": "#alerts"}}',
        '["alerts", "notifications"]',
        '{}',
        true,
        false,
        'ACTIVE',
        1
    );

    RAISE NOTICE 'Inserted 4 groups';
END $$;

-- Verify
SELECT id, name, code, type, member_count, status FROM groups ORDER BY type, name;
