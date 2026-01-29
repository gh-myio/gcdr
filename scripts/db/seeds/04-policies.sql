-- =============================================================================
-- SEED: POLICIES
-- =============================================================================
-- Mock data for policies table (RBAC permissions)
-- Permission format: domain.function.action
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    -- =========================================================================
    -- SYSTEM POLICIES (is_system = true)
    -- =========================================================================

    -- Full Admin Policy (System) - Complete access to everything
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc1111-1111-1111-1111-111111111111',
        v_tenant_id,
        'policy:full-admin',
        'Full Administrator',
        'Complete access to all resources and actions across all domains',
        '["*.*.*"]',
        '[]',
        'critical',
        true,
        1
    );

    -- Read-Only Policy (System) - Read access to everything, no modifications
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc2222-2222-2222-2222-222222222222',
        v_tenant_id,
        'policy:read-only',
        'Read Only Access',
        'Read and list access to all resources, all write operations denied',
        '["*.*.read", "*.*.list"]',
        '["*.*.create", "*.*.update", "*.*.delete", "*.*.execute", "*.*.admin"]',
        'low',
        true,
        1
    );

    -- =========================================================================
    -- DOMAIN POLICIES (is_system = false)
    -- =========================================================================

    -- Device Management Policy - Full access to devices and related resources
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc3333-3333-3333-3333-333333333333',
        v_tenant_id,
        'policy:device-management',
        'Device Management',
        'Full access to device resources including telemetry and commands',
        '[
            "devices.list.read",
            "devices.details.read",
            "devices.settings.read",
            "devices.settings.update",
            "devices.telemetry.read",
            "devices.commands.execute",
            "assets.list.read",
            "assets.details.read",
            "centrals.list.read",
            "centrals.details.read"
        ]',
        '[]',
        'medium',
        false,
        1
    );

    -- User Management Policy - Manage users within scope
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc4444-4444-4444-4444-444444444444',
        v_tenant_id,
        'policy:user-management',
        'User Management',
        'Manage users and role assignments within assigned customer scope',
        '[
            "identity.users.list",
            "identity.users.read",
            "identity.users.create",
            "identity.users.update",
            "identity.users.invite",
            "identity.roles.read",
            "identity.roles.list",
            "identity.assignments.read",
            "identity.assignments.create",
            "identity.assignments.revoke"
        ]',
        '["identity.users.delete", "identity.roles.create", "identity.roles.update", "identity.roles.delete"]',
        'high',
        false,
        1
    );

    -- Alarm Management Policy - Manage alarms and rules
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc5555-5555-5555-5555-555555555555',
        v_tenant_id,
        'policy:alarm-management',
        'Alarm Management',
        'Full access to alarm rules, notifications, and monitoring',
        '[
            "alarms.dashboard.read",
            "alarms.rules.list",
            "alarms.rules.read",
            "alarms.rules.create",
            "alarms.rules.update",
            "alarms.rules.delete",
            "alarms.rules.toggle",
            "alarms.history.read",
            "alarms.notifications.read",
            "alarms.notifications.update"
        ]',
        '[]',
        'medium',
        false,
        1
    );

    -- Reports Policy - Access to reports and analytics
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc6666-6666-6666-6666-666666666666',
        v_tenant_id,
        'policy:reports',
        'Reports Access',
        'Access to generate, view, and export reports and analytics',
        '[
            "reports.energy.read",
            "reports.energy.export",
            "reports.alarms.read",
            "reports.alarms.export",
            "reports.devices.read",
            "reports.devices.export",
            "analytics.dashboards.read",
            "analytics.metrics.read"
        ]',
        '[]',
        'low',
        false,
        1
    );

    -- Customer Management Policy - Manage customer hierarchy
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc7777-7777-7777-7777-777777777777',
        v_tenant_id,
        'policy:customer-management',
        'Customer Management',
        'Manage customer hierarchy, settings, and themes',
        '[
            "customers.hierarchy.read",
            "customers.hierarchy.create",
            "customers.hierarchy.update",
            "customers.settings.read",
            "customers.settings.update",
            "customers.themes.read",
            "customers.themes.update",
            "customers.apikeys.read",
            "customers.apikeys.create",
            "customers.apikeys.revoke"
        ]',
        '["customers.hierarchy.delete"]',
        'high',
        false,
        1
    );

    -- Energy Domain Policy - Energy monitoring and settings
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc8888-8888-8888-8888-888888888888',
        v_tenant_id,
        'policy:energy-management',
        'Energy Management',
        'Access to energy monitoring, dashboards, and settings',
        '[
            "energy.dashboards.read",
            "energy.reports.read",
            "energy.reports.export",
            "energy.settings.read",
            "energy.settings.update",
            "energy.alerts.read",
            "energy.alerts.update"
        ]',
        '[]',
        'medium',
        false,
        1
    );

    -- Integration Management Policy - Manage integrations and marketplace
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc9999-9999-9999-9999-999999999999',
        v_tenant_id,
        'policy:integration-management',
        'Integration Management',
        'Manage integrations, marketplace subscriptions, and webhooks',
        '[
            "integrations.packages.read",
            "integrations.packages.list",
            "integrations.subscriptions.read",
            "integrations.subscriptions.create",
            "integrations.subscriptions.update",
            "integrations.webhooks.read",
            "integrations.webhooks.create",
            "integrations.webhooks.update",
            "integrations.webhooks.delete"
        ]',
        '[]',
        'medium',
        false,
        1
    );

    -- Admin Approval Policy - Approve/reject user registrations (RFC-0011)
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'ccccaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        v_tenant_id,
        'policy:admin-approval',
        'Admin Approval',
        'Approve or reject user registrations and unlock accounts (RFC-0011)',
        '[
            "identity.users.list",
            "identity.users.read",
            "identity.users.approve",
            "identity.users.reject",
            "identity.users.unlock"
        ]',
        '[]',
        'high',
        false,
        1
    );

    RAISE NOTICE 'Inserted 10 policies';
END $$;

-- Verify
SELECT id, key, display_name, risk_level, is_system FROM policies ORDER BY is_system DESC, key;
