-- =============================================================================
-- OPS: SETUP — RIO POTY
-- =============================================================================
--
-- Central:
--   ID            : 1817cd70-cf03-11f0-998e-25174baff087
--   Name          : Central Rio Poty
--   Customer ID   : 8f9af056-10c2-4cd4-a45f-ab0c99377aca
--   Asset ID      : bccbaab6-7f93-4735-8e33-29214018fc9d  (Asset Central Rio Poty)
--   Tenant        : 11111111-1111-1111-1111-111111111111
--
-- API Key:
--   Plaintext     : gcdr_rio_poty_bundle_key_2026
--   SHA256        : dff5b76fb7de4c13e09d6e7d9ae07d5a8daa425bf3f2ea3c1b344170597badfb
--
-- Uso: npm run db:ops scripts/db/ops/rio-poty-setup.sql
-- =============================================================================

-- ----------------------------------------------------------------
-- 1. Central Gateway — Rio Poty
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
    '1817cd70-cf03-11f0-998e-25174baff087',
    '11111111-1111-1111-1111-111111111111',
    '8f9af056-10c2-4cd4-a45f-ab0c99377aca',   -- Rio Poty
    'bccbaab6-7f93-4735-8e33-29214018fc9d',   -- Asset Central Rio Poty
    'Central Rio Poty',
    'Central Rio Poty',
    'SCRPGATEWAY01',
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
-- 2. API Key — Rio Poty (SELF)
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
    '8f9af056-10c2-4cd4-a45f-ab0c99377aca',   -- Rio Poty
    'dff5b76fb7de4c13e09d6e7d9ae07d5a8daa425bf3f2ea3c1b344170597badfb',
    'gcdr_cust_',
    'Rio Poty Bundle Key',
    'API key for Rio Poty alarm bundle integration — gcdr_rio_poty_bundle_key_2026',
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
WHERE id = '1817cd70-cf03-11f0-998e-25174baff087';

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
WHERE k.key_hash = 'dff5b76fb7de4c13e09d6e7d9ae07d5a8daa425bf3f2ea3c1b344170597badfb';
