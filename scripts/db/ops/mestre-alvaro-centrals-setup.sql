-- =============================================================================
-- Setup: Asset + Centrals for Mestre Álvaro
--
-- Customer       : Mestre Álvaro (e04046d4-baa4-44e9-a378-4dfebe4140f1)
-- Tenant         : 11111111-1111-1111-1111-111111111111
-- Asset          : 9a540930-1b8e-11f0-9baa-8137e6ac9d72
--
-- Centrals:
--   L1   : 45250d44-bad0-4071-aaa0-8091cfb12691
--   L2   : d3202744-05dd-46d1-af33-495e9a2ecd52
--   L3-L4: fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e
-- =============================================================================

DO $$
DECLARE
    v_asset_id    UUID := '9a540930-1b8e-11f0-9baa-8137e6ac9d72';
    v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
    v_customer_id UUID := 'e04046d4-baa4-44e9-a378-4dfebe4140f1';
BEGIN
    -- STEP 1: Asset (cria se não existir, senão reutiliza o existente)
    IF NOT EXISTS (
        SELECT 1 FROM assets WHERE id = v_asset_id
    ) THEN
        INSERT INTO assets (
            id, tenant_id, customer_id, parent_asset_id,
            path, depth,
            name, display_name, code, type,
            location, specs, tags, metadata,
            status, version
        ) VALUES (
            v_asset_id,
            v_tenant_id,
            v_customer_id,
            NULL,
            '/11111111-1111-1111-1111-111111111111'
                || '/e04046d4-baa4-44e9-a378-4dfebe4140f1'
                || '/' || v_asset_id,
            0,
            'Centrais Mestre Álvaro - Asset',
            'Centrais Mestre Álvaro - Asset',
            'CENTRAL-ASSET-MESTRE-ALVARO',
            'OTHER',
            '{}', '{}', '[]', '{}',
            'ACTIVE', 1
        );

        RAISE NOTICE 'Asset criado. ID = %', v_asset_id;
    ELSE
        RAISE NOTICE 'Asset já existia. ID = %', v_asset_id;
    END IF;

    -- STEP 2: Centrals
    INSERT INTO centrals (
        id, tenant_id, customer_id, asset_id,
        name, display_name, serial_number,
        type, status, connection_status,
        firmware_version, software_version,
        config, stats, location, tags, metadata, version
    ) VALUES
        (
            '45250d44-bad0-4071-aaa0-8091cfb12691',
            v_tenant_id, v_customer_id, v_asset_id,
            'Central Mestre Álvaro L1',
            'Central Mestre Álvaro L1',
            'MAGATEWAY-L1',
            'GATEWAY', 'ACTIVE', 'OFFLINE',
            '1.0.0', '5.2.0',
            '{}', '{}', '{}', '[]', '{}', 1
        ),
        (
            'd3202744-05dd-46d1-af33-495e9a2ecd52',
            v_tenant_id, v_customer_id, v_asset_id,
            'Central Mestre Álvaro L2',
            'Central Mestre Álvaro L2',
            'MAGATEWAY-L2',
            'GATEWAY', 'ACTIVE', 'OFFLINE',
            '1.0.0', '5.2.0',
            '{}', '{}', '{}', '[]', '{}', 1
        ),
        (
            'fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e',
            v_tenant_id, v_customer_id, v_asset_id,
            'Central Mestre Álvaro L3-L4',
            'Central Mestre Álvaro L3-L4',
            'MAGATEWAY-L3L4',
            'GATEWAY', 'ACTIVE', 'OFFLINE',
            '1.0.0', '5.2.0',
            '{}', '{}', '{}', '[]', '{}', 1
        );

    RAISE NOTICE 'Centrals criadas com asset_id = %', v_asset_id;
END $$;

-- Verify
SELECT id, name, serial_number, type, status, connection_status
FROM centrals
WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
ORDER BY name;
