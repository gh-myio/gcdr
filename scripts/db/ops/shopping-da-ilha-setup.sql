-- =============================================================================
-- OPS: SETUP — SHOPPING DA ILHA
-- =============================================================================
--
-- Central:
--   ID            : cb318f02-1020-4f99-857f-d44d001d939b
--   Name          : Central Shopping da Ilha
--   Customer ID   : f1fcf434-532b-428a-a5e1-0b68e8ae1056
--   Asset ID      : ab734ecc-6d47-4e3c-8897-2027af2c61f3  (Central Shopping da Ilha - Asset)
--   Tenant        : 11111111-1111-1111-1111-111111111111
--
-- API Key:
--   Plaintext     : gcdr_shopping_da_ilha_bundle_key_2026
--   SHA256        : f35812ef7dd5efb83b70ef59a6d91cc455675d76197409bb5c92a0926d8b6f44
--
-- Uso: npm run db:ops scripts/db/ops/shopping-da-ilha-setup.sql
-- =============================================================================

-- ----------------------------------------------------------------
-- 1. Central Gateway — Shopping da Ilha
-- ----------------------------------------------------------------
INSERT INTO centrals (
    id,
    tenant_id,
    customer_id,
    asset_id,
    name,
    display_name,
    serial_number,
    type,
    status,
    connection_status,
    firmware_version,
    software_version,
    config,
    stats,
    location,
    tags,
    metadata,
    version
) VALUES (
    'cb318f02-1020-4f99-857f-d44d001d939b',
    '11111111-1111-1111-1111-111111111111',
    'f1fcf434-532b-428a-a5e1-0b68e8ae1056',   -- Shopping da Ilha
    'ab734ecc-6d47-4e3c-8897-2027af2c61f3',   -- Central Shopping da Ilha - Asset
    'Central Shopping da Ilha',
    'Central Shopping da Ilha',
    'SCSDILHAGATEWAY01',
    'GATEWAY',
    'ACTIVE',
    'OFFLINE',
    '1.0.0',
    '1.0.0',
    '{}',
    '{}',
    '{}',
    '[]',
    '{}',
    1
)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------
-- 2. API Key — Shopping da Ilha (SELF)
-- ----------------------------------------------------------------
INSERT INTO customer_api_keys (
    id,
    tenant_id,
    customer_id,
    key_hash,
    key_prefix,
    name,
    description,
    scopes,
    hierarchy_access,
    expires_at,
    usage_count,
    is_active,
    version
) VALUES (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    'f1fcf434-532b-428a-a5e1-0b68e8ae1056',   -- Shopping da Ilha
    'f35812ef7dd5efb83b70ef59a6d91cc455675d76197409bb5c92a0926d8b6f44',
    'gcdr_cust_',
    'Shopping da Ilha Bundle Key',
    'API key for Shopping da Ilha alarm bundle integration — gcdr_shopping_da_ilha_bundle_key_2026',
    '["customers:read", "bundles:read", "rules:read", "devices:read"]',
    'SELF',
    NOW() + INTERVAL '365 days',
    0,
    true,
    1
)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------
-- Verificação
-- ----------------------------------------------------------------
SELECT id, name, serial_number, type, status, connection_status
FROM centrals
WHERE id = 'cb318f02-1020-4f99-857f-d44d001d939b';

SELECT
    k.id,
    c.name        AS customer_name,
    k.name        AS key_name,
    k.key_prefix,
    k.hierarchy_access,
    k.scopes,
    k.is_active,
    k.expires_at
FROM customer_api_keys k
JOIN customers c ON c.id = k.customer_id
WHERE k.key_hash = 'f35812ef7dd5efb83b70ef59a6d91cc455675d76197409bb5c92a0926d8b6f44';
