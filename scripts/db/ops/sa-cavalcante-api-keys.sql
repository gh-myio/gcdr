-- =============================================================================
-- OPS: CREATE API KEYS — SÁ CAVALCANTE + MYIO TENANT
-- =============================================================================
--
-- 1. Sá Cavalcante  (SUBTREE — acessa SC + todos os filhos: MA, MS, Moxuara)
--    Plaintext:  gcdr_sa_cavalcante_bundle_key_2026
--    SHA256:     9b7869715fa08c771d71f8d2be7a1631b2b79d5ff32e18eb764bd00ebb7fd7e6
--
-- 2. MYIO Tenant  (TENANT — acessa todo o tenant sem restrição de customer)
--    Plaintext:  gcdr_myio_tenant_bundle_key_2026
--    SHA256:     234c403a73f9ccef3db57d6f02a422a51089b6fa52b3aa4341af4755a1761608
--
-- Uso:  npm run db:ops scripts/db/ops/sa-cavalcante-api-keys.sql
-- =============================================================================

-- ----------------------------------------------------------------
-- 1. API Key — Sá Cavalcante (SUBTREE)
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
    created_by,
    version
)
VALUES (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    'b1000000-0000-0000-0000-000000000001',   -- Sá Cavalcante
    '9b7869715fa08c771d71f8d2be7a1631b2b79d5ff32e18eb764bd00ebb7fd7e6',
    'gcdr_cust_',
    'Sá Cavalcante Bundle Key',
    'API key for Sá Cavalcante alarm bundle integration (SUBTREE — MA, MS, Moxuara) — gcdr_sa_cavalcante_bundle_key_2026',
    '["customers:read", "bundles:read", "rules:read", "devices:read"]',
    'SUBTREE',
    NOW() + INTERVAL '365 days',
    0,
    true,
    '00000000-0000-0000-0000-000000000001',
    1
)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------
-- 2. API Key — MYIO Tenant (TENANT — acesso total ao tenant)
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
    created_by,
    version
)
SELECT
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    id,   -- usa o customer root do tenant MYIO
    '234c403a73f9ccef3db57d6f02a422a51089b6fa52b3aa4341af4755a1761608',
    'gcdr_cust_',
    'MYIO Tenant Bundle Key',
    'API key with full tenant access — gcdr_myio_tenant_bundle_key_2026',
    '["customers:read", "bundles:read", "rules:read", "devices:read"]',
    'TENANT',
    NOW() + INTERVAL '365 days',
    0,
    true,
    '00000000-0000-0000-0000-000000000001',
    1
FROM customers
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  AND parent_customer_id IS NULL
LIMIT 1
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------
-- Verificação
-- ----------------------------------------------------------------
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
WHERE k.tenant_id = '11111111-1111-1111-1111-111111111111'
  AND k.key_hash IN (
      '9b7869715fa08c771d71f8d2be7a1631b2b79d5ff32e18eb764bd00ebb7fd7e6',
      '234c403a73f9ccef3db57d6f02a422a51089b6fa52b3aa4341af4755a1761608'
  )
ORDER BY k.name;
