-- =============================================================================
-- SEED: ROLE ASSIGNMENTS
-- =============================================================================
-- Mock data for role_assignments table
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_holding_id UUID := '22222222-2222-2222-2222-222222222222';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_admin_id UUID := 'bbbb1111-1111-1111-1111-111111111111';
    v_joao_id UUID := 'bbbb2222-2222-2222-2222-222222222222';
    v_maria_id UUID := 'bbbb3333-3333-3333-3333-333333333333';
    v_partner_dev_id UUID := 'bbbb4444-4444-4444-4444-444444444444';
BEGIN
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

    -- João -> Customer Admin for Company 1
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee2222-2222-2222-2222-222222222222',
        v_tenant_id,
        v_joao_id,
        'role:customer-admin',
        'customer:' || v_company1_id,
        'active',
        v_admin_id,
        NOW() - INTERVAL '60 days',
        'Promoted to customer administrator',
        1
    );

    -- João -> Operations Manager for Holding (additional role)
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee3333-3333-3333-3333-333333333333',
        v_tenant_id,
        v_joao_id,
        'role:operations-manager',
        'customer:' || v_holding_id,
        'active',
        v_admin_id,
        NOW() - INTERVAL '30 days',
        'Extended access to holding operations',
        1
    );

    -- Maria -> Technician for Company 1
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee4444-4444-4444-4444-444444444444',
        v_tenant_id,
        v_maria_id,
        'role:technician',
        'customer:' || v_company1_id,
        'active',
        v_joao_id,
        NOW() - INTERVAL '45 days',
        'Technical team member',
        1
    );

    -- Partner Developer -> Viewer (limited scope)
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, expires_at, reason, version)
    VALUES (
        'eeee5555-5555-5555-5555-555555555555',
        v_tenant_id,
        v_partner_dev_id,
        'role:viewer',
        'customer:' || v_company1_id,
        'active',
        v_admin_id,
        NOW() - INTERVAL '10 days',
        NOW() + INTERVAL '90 days',
        'Partner integration access - temporary',
        1
    );

    -- Expired assignment example
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, expires_at, reason, version)
    VALUES (
        'eeee6666-6666-6666-6666-666666666666',
        v_tenant_id,
        v_maria_id,
        'role:operations-manager',
        'customer:' || v_company1_id,
        'expired',
        v_joao_id,
        NOW() - INTERVAL '120 days',
        NOW() - INTERVAL '30 days',
        'Temporary operations access during project',
        1
    );

    RAISE NOTICE 'Inserted 6 role assignments';
END $$;

-- Verify
SELECT ra.id, u.email, ra.role_key, ra.scope, ra.status
FROM role_assignments ra
JOIN users u ON ra.user_id = u.id
ORDER BY ra.status, u.email;
