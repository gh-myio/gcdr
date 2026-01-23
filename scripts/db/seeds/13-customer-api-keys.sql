-- =============================================================================
-- SEED: CUSTOMER API KEYS
-- =============================================================================
-- Mock data for customer_api_keys table
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_admin_id UUID := 'bbbb1111-1111-1111-1111-111111111111';
    v_joao_id UUID := 'bbbb2222-2222-2222-2222-222222222222';
BEGIN
    -- Production API Key
    INSERT INTO customer_api_keys (id, tenant_id, customer_id, key_hash, key_prefix, name, description, scopes, expires_at, last_used_at, last_used_ip, usage_count, is_active, created_by, version)
    VALUES (
        'cee00001-0001-0001-0001-000000000001',
        v_tenant_id,
        v_company1_id,
        'sha256:a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
        'gcdr_prod_',
        'Production API Key',
        'Main production API key for ACME Tech integrations',
        '["devices:read", "devices:write", "telemetry:read", "telemetry:write", "alarms:read", "alarms:acknowledge"]',
        NOW() + INTERVAL '365 days',
        NOW() - INTERVAL '1 hour',
        '192.168.1.100',
        15420,
        true,
        v_admin_id,
        1
    );

    -- Development API Key
    INSERT INTO customer_api_keys (id, tenant_id, customer_id, key_hash, key_prefix, name, description, scopes, expires_at, last_used_at, last_used_ip, usage_count, is_active, created_by, version)
    VALUES (
        'cee00001-0001-0001-0001-000000000002',
        v_tenant_id,
        v_company1_id,
        'sha256:b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1',
        'gcdr_dev_',
        'Development API Key',
        'API key for development and testing environment',
        '["devices:read", "telemetry:read", "alarms:read"]',
        NOW() + INTERVAL '90 days',
        NOW() - INTERVAL '30 minutes',
        '10.0.0.50',
        3521,
        true,
        v_joao_id,
        1
    );

    -- Read-only API Key
    INSERT INTO customer_api_keys (id, tenant_id, customer_id, key_hash, key_prefix, name, description, scopes, expires_at, last_used_at, usage_count, is_active, created_by, version)
    VALUES (
        'cee00001-0001-0001-0001-000000000003',
        v_tenant_id,
        v_company1_id,
        'sha256:c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2',
        'gcdr_ro_',
        'Dashboard Read-Only Key',
        'Read-only key for dashboard and reporting applications',
        '["devices:read", "telemetry:read", "assets:read", "reports:read"]',
        NOW() + INTERVAL '180 days',
        NOW() - INTERVAL '5 minutes',
        8932,
        true,
        v_joao_id,
        1
    );

    -- Expired API Key
    INSERT INTO customer_api_keys (id, tenant_id, customer_id, key_hash, key_prefix, name, description, scopes, expires_at, last_used_at, usage_count, is_active, created_by, version)
    VALUES (
        'cee00001-0001-0001-0001-000000000004',
        v_tenant_id,
        v_company1_id,
        'sha256:d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3',
        'gcdr_old_',
        'Legacy Integration Key',
        'Old API key from legacy system integration - expired',
        '["devices:read"]',
        NOW() - INTERVAL '30 days',
        NOW() - INTERVAL '35 days',
        12000,
        false,
        v_admin_id,
        1
    );

    -- Revoked API Key
    INSERT INTO customer_api_keys (id, tenant_id, customer_id, key_hash, key_prefix, name, description, scopes, last_used_at, usage_count, is_active, created_by, version)
    VALUES (
        'cee00001-0001-0001-0001-000000000005',
        v_tenant_id,
        v_company1_id,
        'sha256:e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a1b2c3d4',
        'gcdr_rev_',
        'Revoked Key - Security Issue',
        'API key revoked due to potential security breach',
        '["*"]',
        NOW() - INTERVAL '60 days',
        500,
        false,
        v_admin_id,
        1
    );

    RAISE NOTICE 'Inserted 5 customer API keys';
END $$;

-- Verify
SELECT id, name, key_prefix, is_active, usage_count, expires_at FROM customer_api_keys ORDER BY is_active DESC, usage_count DESC;
