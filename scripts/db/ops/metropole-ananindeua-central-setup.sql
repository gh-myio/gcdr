-- =============================================================================
-- OPS: Central Gateway + API Key — Shopping Metrópole Ananindeua
--
-- Customer ID  : c4030d78-1cf4-4bf6-8eed-c12b4e7c281a
-- Tenant ID    : 11111111-1111-1111-1111-111111111111
-- Central ID   : 7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a
-- Asset ID     : 67b27a26-127e-4299-86d5-ea87cbabd665  (já existente via API)
--
-- API Key
--   Plaintext : gcdr_metropole_ananindeua_bundle_key_2026
--   SHA256    : 1882e2af8a6b05f12192fcfe0953c49a672799c6dc2c57862aca4934f48881b2
--
-- Uso: executar no banco de produção via psql ou DBeaver
-- =============================================================================

DO $$
DECLARE
    v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
    v_customer_id UUID := 'c4030d78-1cf4-4bf6-8eed-c12b4e7c281a';
    v_central_id  UUID := '7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a';
    v_asset_id    UUID := '67b27a26-127e-4299-86d5-ea87cbabd665';
BEGIN

    -- ----------------------------------------------------------------
    -- STEP 1: Central Gateway
    -- ----------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM centrals WHERE id = v_central_id) THEN
        INSERT INTO centrals (
            id, tenant_id, customer_id, asset_id,
            name, display_name, serial_number,
            type, status, connection_status,
            firmware_version, software_version,
            config, stats, location, tags, metadata, version
        ) VALUES (
            v_central_id,
            v_tenant_id,
            v_customer_id,
            v_asset_id,
            'Central Metrópole Ananindeua',
            'Central Metrópole Ananindeua',
            'MAGATEWAY-METROPOLE-ANA',
            'GATEWAY', 'ACTIVE', 'OFFLINE',
            '1.0.0', '5.2.0',
            '{}', '{}', '{}', '[]', '{}', 1
        );
        RAISE NOTICE 'Central criada. ID = %', v_central_id;
    ELSE
        RAISE NOTICE 'Central já existia. ID = %', v_central_id;
    END IF;

    -- ----------------------------------------------------------------
    -- STEP 2: API Key (SUBTREE — acessa o customer e seus filhos)
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
    ) VALUES (
        gen_random_uuid(),
        v_tenant_id,
        v_customer_id,
        '1882e2af8a6b05f12192fcfe0953c49a672799c6dc2c57862aca4934f48881b2',
        'gcdr_cust_',
        'Metrópole Ananindeua Bundle Key',
        'API key para integração alarm-bundle — gcdr_metropole_ananindeua_bundle_key_2026',
        '["customers:read", "bundles:read", "rules:read", "devices:read"]',
        'SUBTREE',
        NOW() + INTERVAL '365 days',
        0,
        true,
        '00000000-0000-0000-0000-000000000001',
        1
    )
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'API key inserida para customer %', v_customer_id;

END $$;

-- ----------------------------------------------------------------
-- Verificação
-- ----------------------------------------------------------------
SELECT id, name, serial_number, type, status, connection_status, asset_id
FROM centrals
WHERE id = '7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a';

SELECT k.id, k.name, k.key_prefix, k.hierarchy_access, k.scopes, k.is_active, k.expires_at
FROM customer_api_keys k
WHERE k.key_hash = '1882e2af8a6b05f12192fcfe0953c49a672799c6dc2c57862aca4934f48881b2';
