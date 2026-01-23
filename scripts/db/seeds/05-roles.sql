-- =============================================================================
-- SEED: ROLES
-- =============================================================================
-- Mock data for roles table
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    -- Super Admin Role (System)
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd1111-1111-1111-1111-111111111111',
        v_tenant_id,
        'role:super-admin',
        'Super Administrator',
        'Full system access with all privileges',
        '["policy:full-admin"]',
        '["admin", "system"]',
        'critical',
        true,
        1
    );

    -- Customer Admin Role
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd2222-2222-2222-2222-222222222222',
        v_tenant_id,
        'role:customer-admin',
        'Customer Administrator',
        'Administrative access within customer scope',
        '["policy:user-management", "policy:device-management", "policy:alarm-management", "policy:reports"]',
        '["admin", "customer"]',
        'high',
        true,
        1
    );

    -- Operations Manager Role
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd3333-3333-3333-3333-333333333333',
        v_tenant_id,
        'role:operations-manager',
        'Operations Manager',
        'Manage devices, alarms, and view reports',
        '["policy:device-management", "policy:alarm-management", "policy:reports"]',
        '["operations", "manager"]',
        'medium',
        false,
        1
    );

    -- Technician Role
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd4444-4444-4444-4444-444444444444',
        v_tenant_id,
        'role:technician',
        'Field Technician',
        'Access to devices and basic operations',
        '["policy:device-management"]',
        '["technician", "field"]',
        'low',
        false,
        1
    );

    -- Viewer Role
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd5555-5555-5555-5555-555555555555',
        v_tenant_id,
        'role:viewer',
        'Viewer',
        'Read-only access to all resources',
        '["policy:read-only", "policy:reports"]',
        '["viewer", "readonly"]',
        'low',
        true,
        1
    );

    RAISE NOTICE 'Inserted 5 roles';
END $$;

-- Verify
SELECT id, key, display_name, risk_level, is_system FROM roles ORDER BY risk_level DESC, key;
