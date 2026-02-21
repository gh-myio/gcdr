-- =============================================================================
-- Setup: Asset + Central for Moxuara
--
-- Customer       : Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
-- Tenant         : 11111111-1111-1111-1111-111111111111
--
-- STEP 1: Run the asset DO block and note the generated asset_id
-- STEP 2: Run the central INSERT using the asset_id from STEP 1
-- =============================================================================

-- =============================================================================
-- STEP 1: Create Central_Asset_Moxuara
-- After running, retrieve the ID with the SELECT below
-- Result: 2a257caa-a184-4304-9561-adf8e21814ca
-- =============================================================================

DO $$
DECLARE
    v_asset_id UUID := gen_random_uuid();
BEGIN
    INSERT INTO assets (
        id, tenant_id, customer_id, parent_asset_id,
        path, depth,
        name, display_name, code, type,
        location, specs, tags, metadata,
        status, version
    ) VALUES (
        v_asset_id,
        '11111111-1111-1111-1111-111111111111',
        '84e0370e-636a-4741-9874-504b5e0b3577',
        NULL,
        '/11111111-1111-1111-1111-111111111111'
            || '/84e0370e-636a-4741-9874-504b5e0b3577'
            || '/' || v_asset_id,
        0,
        'Central_Asset_Moxuara',
        'Central Asset Moxuara',
        'CENTRAL-ASSET-MOXUARA',
        'OTHER',
        '{}', '{}', '[]', '{}',
        'ACTIVE', 1
    );

    RAISE NOTICE 'Asset criado. ID = %', v_asset_id;
END $$;

-- Retrieve generated asset_id:
SELECT id, name, path FROM assets
WHERE code = 'CENTRAL-ASSET-MOXUARA'
  AND customer_id = '84e0370e-636a-4741-9874-504b5e0b3577';
-- Result: 2a257caa-a184-4304-9561-adf8e21814ca
