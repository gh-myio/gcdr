-- =============================================================================
-- SEED: ROLES
-- =============================================================================
-- Mock data for roles table
-- Roles reference policies by key (policies array contains policy keys)
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    -- =========================================================================
    -- SYSTEM ROLES (is_system = true)
    -- =========================================================================

    -- Super Admin Role - Full system access
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd1111-1111-1111-1111-111111111111',
        v_tenant_id,
        'role:super-admin',
        'Super Administrator',
        'Full system access with all privileges across all domains and customers',
        '["policy:full-admin"]',
        '["admin", "system", "critical"]',
        'critical',
        true,
        1
    );

    -- Viewer Role - Read-only access
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd2222-2222-2222-2222-222222222222',
        v_tenant_id,
        'role:viewer',
        'Viewer',
        'Read-only access to all resources, with reports access',
        '["policy:read-only", "policy:reports"]',
        '["viewer", "readonly"]',
        'low',
        true,
        1
    );

    -- =========================================================================
    -- BUSINESS ROLES (is_system = false)
    -- =========================================================================

    -- Customer Admin Role - Full admin within customer scope
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd3333-3333-3333-3333-333333333333',
        v_tenant_id,
        'role:customer-admin',
        'Customer Administrator',
        'Full administrative access within assigned customer scope including users, devices, alarms, and reports',
        '["policy:user-management", "policy:device-management", "policy:alarm-management", "policy:reports", "policy:customer-management", "policy:admin-approval"]',
        '["admin", "customer"]',
        'high',
        false,
        1
    );

    -- Operations Manager Role - Manage operations and view reports
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd4444-4444-4444-4444-444444444444',
        v_tenant_id,
        'role:operations-manager',
        'Operations Manager',
        'Manage devices, alarms, and view reports for operations team',
        '["policy:device-management", "policy:alarm-management", "policy:reports"]',
        '["operations", "manager"]',
        'medium',
        false,
        1
    );

    -- Technician Role - Field technician access
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd5555-5555-5555-5555-555555555555',
        v_tenant_id,
        'role:technician',
        'Field Technician',
        'Access to devices, telemetry, and commands for field maintenance',
        '["policy:device-management"]',
        '["technician", "field"]',
        'low',
        false,
        1
    );

    -- Alarm Operator Role - Monitor and manage alarms
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd6666-6666-6666-6666-666666666666',
        v_tenant_id,
        'role:alarm-operator',
        'Alarm Operator',
        'Monitor alarms, manage rules, and view alarm history',
        '["policy:alarm-management", "policy:reports"]',
        '["operator", "alarms", "monitoring"]',
        'medium',
        false,
        1
    );

    -- Energy Analyst Role - Energy monitoring and reporting
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd7777-7777-7777-7777-777777777777',
        v_tenant_id,
        'role:energy-analyst',
        'Energy Analyst',
        'Access to energy dashboards, reports, and settings',
        '["policy:energy-management", "policy:reports"]',
        '["analyst", "energy"]',
        'low',
        false,
        1
    );

    -- Integration Manager Role - Manage integrations and marketplace
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd8888-8888-8888-8888-888888888888',
        v_tenant_id,
        'role:integration-manager',
        'Integration Manager',
        'Manage integrations, marketplace subscriptions, and webhooks',
        '["policy:integration-management", "policy:reports"]',
        '["manager", "integrations"]',
        'medium',
        false,
        1
    );

    -- User Admin Role - User management only (RFC-0011)
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd9999-9999-9999-9999-999999999999',
        v_tenant_id,
        'role:user-admin',
        'User Administrator',
        'Manage users, approve registrations, and handle role assignments',
        '["policy:user-management", "policy:admin-approval"]',
        '["admin", "users"]',
        'high',
        false,
        1
    );

    RAISE NOTICE 'Inserted 9 roles';
END $$;

-- Verify
SELECT id, key, display_name, risk_level, is_system FROM roles ORDER BY is_system DESC, risk_level DESC, key;
