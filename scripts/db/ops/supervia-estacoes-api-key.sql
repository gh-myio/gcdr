-- =============================================================================
-- OPS: CREATE API KEY — CUSTOMER SUPERVIA ESTAÇÕES
-- =============================================================================
-- Customer: Supervia Estações
-- gcdr ID:  01c0179c-08d5-4bb8-9a3c-743327ac63d1
-- Tenant:   11111111-1111-1111-1111-111111111111
--
-- Plaintext Key: gcdr_supervia_estacoes_bundle_key_2026
-- Hash: SHA256('gcdr_supervia_estacoes_bundle_key_2026')
-- =============================================================================

INSERT INTO customer_api_keys (
    id,
    tenant_id,
    customer_id,
    key_hash,
    key_prefix,
    name,
    description,
    scopes,
    expires_at,
    usage_count,
    is_active,
    created_by,
    version
)
VALUES (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    '01c0179c-08d5-4bb8-9a3c-743327ac63d1',
    '5b99f30168e7a1755bcd9d3d1aa6e49c61c7d98420a4dec49aefa4eb27aa0f7d',
    'gcdr_cust_',
    'Supervia Estações Bundle Key',
    'API key for Supervia Estações alarm bundle integration — gcdr_supervia_estacoes_bundle_key_2026',
    '["customers:read", "bundles:read", "rules:read", "devices:read"]',
    NOW() + INTERVAL '365 days',
    0,
    true,
    '00000000-0000-0000-0000-000000000001',
    1
);

-- Verify
SELECT id, customer_id, name, key_prefix, scopes, is_active, expires_at
FROM customer_api_keys
WHERE customer_id = '01c0179c-08d5-4bb8-9a3c-743327ac63d1';
