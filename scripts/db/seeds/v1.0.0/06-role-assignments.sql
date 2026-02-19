-- =============================================================================
-- SEED: ROLE ASSIGNMENTS
-- =============================================================================
-- Mock data for role_assignments table
-- Links users to roles with specific scopes
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_holding_id UUID := '22222222-2222-2222-2222-222222222222';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_company2_id UUID := '44444444-4444-4444-4444-444444444444';
    -- Users
    v_admin_id UUID := 'bbbb1111-1111-1111-1111-111111111111';
    v_joao_id UUID := 'bbbb2222-2222-2222-2222-222222222222';
    v_maria_id UUID := 'bbbb3333-3333-3333-3333-333333333333';
    v_partner_dev_id UUID := 'bbbb4444-4444-4444-4444-444444444444';
    v_service_id UUID := 'bbbb5555-5555-5555-5555-555555555555';
BEGIN
    -- =========================================================================
    -- SUPER ADMIN ASSIGNMENTS (global scope)
    -- =========================================================================

    -- Admin user -> Super Admin role (global scope)
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee1111-1111-1111-1111-111111111111',
        v_tenant_id,
        v_admin_id,
        'role:super-admin',
        '*',
        'active',
        v_admin_id,
        NOW() - INTERVAL '90 days',
        'Initial system administrator setup',
        1
    );

    -- Service Account -> Super Admin for system integrations
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee2222-2222-2222-2222-222222222222',
        v_tenant_id,
        v_service_id,
        'role:super-admin',
        '*',
        'active',
        v_admin_id,
        NOW() - INTERVAL '90 days',
        'Service account for system integrations',
        1
    );

    -- =========================================================================
    -- CUSTOMER ADMIN ASSIGNMENTS (customer scope)
    -- =========================================================================

    -- João -> Customer Admin for Company 1 (ACME Tech)
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee3333-3333-3333-3333-333333333333',
        v_tenant_id,
        v_joao_id,
        'role:customer-admin',
        'customer:' || v_company1_id,
        'active',
        v_admin_id,
        NOW() - INTERVAL '60 days',
        'Promoted to customer administrator for ACME Tech',
        1
    );

    -- =========================================================================
    -- OPERATIONS ASSIGNMENTS
    -- =========================================================================

    -- João -> Operations Manager for Holding (additional role for broader view)
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee4444-4444-4444-4444-444444444444',
        v_tenant_id,
        v_joao_id,
        'role:operations-manager',
        'customer:' || v_holding_id,
        'active',
        v_admin_id,
        NOW() - INTERVAL '30 days',
        'Extended operations access to holding level',
        1
    );

    -- =========================================================================
    -- TECHNICIAN ASSIGNMENTS
    -- =========================================================================

    -- Maria -> Technician for Company 1
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee5555-5555-5555-5555-555555555555',
        v_tenant_id,
        v_maria_id,
        'role:technician',
        'customer:' || v_company1_id,
        'active',
        v_joao_id,
        NOW() - INTERVAL '45 days',
        'Field technician for ACME Tech locations',
        1
    );

    -- Maria -> Alarm Operator for Company 1 (additional role)
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee6666-6666-6666-6666-666666666666',
        v_tenant_id,
        v_maria_id,
        'role:alarm-operator',
        'customer:' || v_company1_id,
        'active',
        v_joao_id,
        NOW() - INTERVAL '30 days',
        'Added alarm monitoring responsibilities',
        1
    );

    -- =========================================================================
    -- PARTNER ASSIGNMENTS (limited scope, with expiration)
    -- =========================================================================

    -- Partner Developer -> Viewer (limited scope with expiration)
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, expires_at, reason, version)
    VALUES (
        'eeee7777-7777-7777-7777-777777777777',
        v_tenant_id,
        v_partner_dev_id,
        'role:viewer',
        'customer:' || v_company1_id,
        'active',
        v_admin_id,
        NOW() - INTERVAL '10 days',
        NOW() + INTERVAL '90 days',
        'Partner integration development - temporary read access',
        1
    );

    -- Partner Developer -> Integration Manager (for testing integrations)
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, expires_at, reason, version)
    VALUES (
        'eeee8888-8888-8888-8888-888888888888',
        v_tenant_id,
        v_partner_dev_id,
        'role:integration-manager',
        'customer:' || v_company1_id,
        'active',
        v_admin_id,
        NOW() - INTERVAL '10 days',
        NOW() + INTERVAL '90 days',
        'Partner integration development - integration management',
        1
    );

    -- =========================================================================
    -- EXPIRED/INACTIVE ASSIGNMENTS (for testing)
    -- =========================================================================

    -- Expired assignment example - Maria had temporary operations access
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, expires_at, reason, version)
    VALUES (
        'eeee9999-9999-9999-9999-999999999999',
        v_tenant_id,
        v_maria_id,
        'role:operations-manager',
        'customer:' || v_company1_id,
        'expired',
        v_joao_id,
        NOW() - INTERVAL '120 days',
        NOW() - INTERVAL '30 days',
        'Temporary operations access during special project',
        1
    );

    -- Inactive assignment example - revoked access
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeeeaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        v_tenant_id,
        v_maria_id,
        'role:energy-analyst',
        'customer:' || v_company1_id,
        'inactive',
        v_joao_id,
        NOW() - INTERVAL '60 days',
        'Energy analyst role - revoked after team restructure',
        1
    );

    RAISE NOTICE 'Inserted 10 role assignments';
END $$;

-- Verify
SELECT
    ra.id,
    u.email,
    ra.role_key,
    ra.scope,
    ra.status,
    ra.expires_at
FROM role_assignments ra
JOIN users u ON ra.user_id = u.id
ORDER BY ra.status, u.email, ra.role_key;
