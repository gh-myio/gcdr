-- =============================================================================
-- SEED: MAINTENANCE GROUPS (RFC-0013)
-- =============================================================================
-- Maintenance groups for organizing technicians and operations teams
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_myio_holding_id UUID := 'aaaa1111-1111-1111-1111-111111111111';
    v_acme_company_id UUID := 'aaaa2222-2222-2222-2222-222222222222';
    v_admin_id UUID := 'bbbb1111-1111-1111-1111-111111111111';
    v_joao_id UUID := 'bbbb2222-2222-2222-2222-222222222222';
    v_maria_id UUID := 'bbbb3333-3333-3333-3333-333333333333';
    v_group_alpha_id UUID := 'eeee1111-1111-1111-1111-111111111111';
    v_group_beta_id UUID := 'eeee2222-2222-2222-2222-222222222222';
    v_group_external_id UUID := 'eeee3333-3333-3333-3333-333333333333';
BEGIN
    -- =========================================================================
    -- MAINTENANCE GROUPS
    -- =========================================================================

    -- Maintenance Team Alpha (internal team for holding)
    INSERT INTO maintenance_groups (id, tenant_id, key, name, description, customer_id, member_count, is_active, version)
    VALUES (
        v_group_alpha_id,
        v_tenant_id,
        'group:maintenance-team-alpha',
        'Equipe de Manutencao Alpha',
        'Equipe interna responsavel pela regiao Sul - Shopping centers e edificios comerciais',
        v_myio_holding_id,
        2,
        true,
        1
    );

    -- Maintenance Team Beta (internal team for holding)
    INSERT INTO maintenance_groups (id, tenant_id, key, name, description, customer_id, member_count, is_active, version)
    VALUES (
        v_group_beta_id,
        v_tenant_id,
        'group:maintenance-team-beta',
        'Equipe de Manutencao Beta',
        'Equipe interna responsavel pela regiao Norte - Industrias e armazens',
        v_myio_holding_id,
        0,
        true,
        1
    );

    -- External Contractors (for company)
    INSERT INTO maintenance_groups (id, tenant_id, key, name, description, customer_id, member_count, is_active, version)
    VALUES (
        v_group_external_id,
        v_tenant_id,
        'group:maintenance-external',
        'Terceirizados',
        'Equipe de manutencao terceirizada - Acesso limitado',
        v_acme_company_id,
        1,
        true,
        1
    );

    RAISE NOTICE 'Inserted 3 maintenance groups';

    -- =========================================================================
    -- USER MAINTENANCE GROUP ASSIGNMENTS
    -- =========================================================================

    -- Joao is in Alpha team
    INSERT INTO user_maintenance_groups (id, tenant_id, user_id, group_id, assigned_at, assigned_by)
    VALUES (
        'ffff1111-1111-1111-1111-111111111111',
        v_tenant_id,
        v_joao_id,
        v_group_alpha_id,
        NOW(),
        v_admin_id
    );

    -- Maria is in Alpha team
    INSERT INTO user_maintenance_groups (id, tenant_id, user_id, group_id, assigned_at, assigned_by)
    VALUES (
        'ffff2222-2222-2222-2222-222222222222',
        v_tenant_id,
        v_maria_id,
        v_group_alpha_id,
        NOW(),
        v_admin_id
    );

    -- Maria also has temporary access to external team (expires in 30 days)
    INSERT INTO user_maintenance_groups (id, tenant_id, user_id, group_id, assigned_at, assigned_by, expires_at)
    VALUES (
        'ffff3333-3333-3333-3333-333333333333',
        v_tenant_id,
        v_maria_id,
        v_group_external_id,
        NOW(),
        v_admin_id,
        NOW() + INTERVAL '30 days'
    );

    RAISE NOTICE 'Inserted 3 user maintenance group assignments';
END $$;

-- Verify maintenance groups
SELECT mg.id, mg.key, mg.name, mg.member_count, mg.is_active, c.name as customer_name
FROM maintenance_groups mg
LEFT JOIN customers c ON c.id = mg.customer_id
ORDER BY mg.key;

-- Verify user assignments
SELECT
    u.email as user_email,
    mg.name as group_name,
    umg.assigned_at,
    umg.expires_at
FROM user_maintenance_groups umg
JOIN users u ON u.id = umg.user_id
JOIN maintenance_groups mg ON mg.id = umg.group_id
ORDER BY mg.name, u.email;
