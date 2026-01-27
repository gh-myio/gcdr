-- =============================================================================
-- SEED: POLICIES
-- =============================================================================
-- Mock data for policies table (RBAC permissions)
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    -- Full Admin Policy (System)
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc1111-1111-1111-1111-111111111111',
        v_tenant_id,
        'policy:full-admin',
        'Full Administrator',
        'Complete access to all resources and actions',
        '["*:*"]',
        '[]',
        'critical',
        true,
        1
    );

    -- Read-Only Policy
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc2222-2222-2222-2222-222222222222',
        v_tenant_id,
        'policy:read-only',
        'Read Only Access',
        'Read access to all resources, no modifications allowed',
        '["*:read", "*:list"]',
        '["*:write", "*:delete", "*:admin"]',
        'low',
        true,
        1
    );

    -- Device Management Policy
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc3333-3333-3333-3333-333333333333',
        v_tenant_id,
        'policy:device-management',
        'Device Management',
        'Full access to device resources',
        '["devices:*", "assets:read", "telemetry:*", "commands:*"]',
        '[]',
        'medium',
        false,
        1
    );

    -- User Management Policy
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc4444-4444-4444-4444-444444444444',
        v_tenant_id,
        'policy:user-management',
        'User Management',
        'Manage users within assigned customers',
        '["users:*", "roles:read", "role-assignments:*"]',
        '["users:delete-admin", "roles:write"]',
        'high',
        false,
        1
    );

    -- Alarm Management Policy
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc5555-5555-5555-5555-555555555555',
        v_tenant_id,
        'policy:alarm-management',
        'Alarm Management',
        'Manage alarms and rules',
        '["alarms:*", "rules:*", "notifications:*"]',
        '[]',
        'medium',
        false,
        1
    );

    -- Reports Policy
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc6666-6666-6666-6666-666666666666',
        v_tenant_id,
        'policy:reports',
        'Reports Access',
        'Access to generate and view reports',
        '["reports:*", "analytics:read", "dashboards:read"]',
        '[]',
        'low',
        false,
        1
    );

    RAISE NOTICE 'Inserted 6 policies';
END $$;

-- Verify
SELECT id, key, display_name, risk_level, is_system FROM policies ORDER BY is_system DESC, key;
