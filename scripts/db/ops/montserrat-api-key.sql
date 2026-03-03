-- =============================================================================
-- OPS: CREATE API KEY — CUSTOMER MONTSERRAT
-- =============================================================================
-- Customer: Montserrat
-- gcdr ID:  4eb817a0-52fe-4011-980a-199854dddeb9
-- Tenant:   11111111-1111-1111-1111-111111111111
--
-- Plaintext Key: gcdr_montserrat_bundle_key_2026
-- Hash: SHA256('gcdr_montserrat_bundle_key_2026')
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
    '4eb817a0-52fe-4011-980a-199854dddeb9',
    '55118aad98ee7551418d2fbf0402f1c29c15cd04c3992a894ec8e49f9d8e75f0',
    'gcdr_cust_',
    'Montserrat Bundle Key',
    'API key for Montserrat alarm bundle integration — gcdr_montserrat_bundle_key_2026',
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
WHERE customer_id = '4eb817a0-52fe-4011-980a-199854dddeb9';
