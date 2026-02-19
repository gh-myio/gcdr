-- =============================================================================
-- SEED: ALARM BUNDLE VERSIONS
-- =============================================================================
-- Sample version history for alarm bundles
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_dimension_id UUID := '77777777-7777-7777-7777-777777777777';
    v_admin_id UUID := 'bbbb1111-1111-1111-1111-111111111111';
BEGIN
    -- ACME Tech: Initial bundle generation (cache_expired)
    INSERT INTO alarm_bundle_versions (id, tenant_id, customer_id, version, previous_version, bundle_type, reason, entity_type, entity_id, rules_count, devices_count, created_at, created_by)
    VALUES (
        'cccc0001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_company1_id,
        'v1-a1b2c3d4e5f6',
        NULL,
        'simple',
        'cache_expired',
        'system',
        NULL,
        20,
        5,
        NOW() - INTERVAL '2 hours',
        NULL
    );

    -- ACME Tech: Rule created -> new version
    INSERT INTO alarm_bundle_versions (id, tenant_id, customer_id, version, previous_version, bundle_type, reason, entity_type, entity_id, rules_count, devices_count, created_at, created_by)
    VALUES (
        'cccc0001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_company1_id,
        'v1-b2c3d4e5f6a7',
        'v1-a1b2c3d4e5f6',
        'simple',
        'rule_created',
        'rule',
        'aaaa0001-0001-0001-0001-000000000001',
        21,
        5,
        NOW() - INTERVAL '1 hour',
        v_admin_id
    );

    -- ACME Tech: Device updated -> new version
    INSERT INTO alarm_bundle_versions (id, tenant_id, customer_id, version, previous_version, bundle_type, reason, entity_type, entity_id, rules_count, devices_count, created_at, created_by)
    VALUES (
        'cccc0001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_company1_id,
        'v1-c3d4e5f6a7b8',
        'v1-b2c3d4e5f6a7',
        'simple',
        'device_updated',
        'device',
        '11110001-0001-0001-0001-000000000001',
        21,
        5,
        NOW() - INTERVAL '30 minutes',
        v_admin_id
    );

    -- Dimension: Initial bundle generation
    INSERT INTO alarm_bundle_versions (id, tenant_id, customer_id, version, previous_version, bundle_type, reason, entity_type, entity_id, rules_count, devices_count, created_at, created_by)
    VALUES (
        'cccc0001-0001-0001-0001-000000000004',
        v_tenant_id,
        v_dimension_id,
        'v1-d4e5f6a7b8c9',
        NULL,
        'simple',
        'cache_expired',
        'system',
        NULL,
        25,
        9,
        NOW() - INTERVAL '3 hours',
        NULL
    );

    -- Dimension: Rule toggled -> new version
    INSERT INTO alarm_bundle_versions (id, tenant_id, customer_id, version, previous_version, bundle_type, reason, entity_type, entity_id, rules_count, devices_count, created_at, created_by)
    VALUES (
        'cccc0001-0001-0001-0001-000000000005',
        v_tenant_id,
        v_dimension_id,
        'v1-e5f6a7b8c9d0',
        'v1-d4e5f6a7b8c9',
        'simple',
        'rule_toggled',
        'rule',
        'bbbb0001-0001-0001-0001-000000000001',
        24,
        9,
        NOW() - INTERVAL '1 hour',
        v_admin_id
    );

    RAISE NOTICE 'Inserted 5 alarm bundle version records';
END $$;

-- Verify
SELECT id, customer_id, version, bundle_type, reason, entity_type, rules_count, devices_count, created_at
FROM alarm_bundle_versions ORDER BY created_at;
