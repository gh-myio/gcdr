-- =============================================================================
-- OPS: Central (gateway) nova + 2 devices 3F de entrada — Moxuara (SMO)
--
-- Tenant       : 11111111-1111-1111-1111-111111111111
-- Customer     : 84e0370e-636a-4741-9874-504b5e0b3577  (Moxuara)
-- Asset        : 2a257caa-a184-4304-9561-adf8e21814ca  (Central_Asset_Moxuara)
-- Central/GW   : 6d7cd66a-c6dd-40df-b40b-e1bad295e424  (ID fixo, exigido pelo ingestion)
--
-- Devices:
--   slave 1 -> 3F SCMoxuara_CAGEntrada x1650 x20A x90.5V          (medidor CAG)
--   slave 2 -> 3F SCMOXUARAAC_Trafo_Entrada_L2 x1650 x20A x90.5V  (medidor Condomínio)
--
-- Idempotente: reexecutar não duplica (guardas IF NOT EXISTS por id / por
-- central+slave). Rodar em produção via psql ou DBeaver.
-- =============================================================================

DO $$
DECLARE
    v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
    v_customer_id UUID := '84e0370e-636a-4741-9874-504b5e0b3577';
    v_asset_id    UUID := '2a257caa-a184-4304-9561-adf8e21814ca';
    v_central_id  UUID := '6d7cd66a-c6dd-40df-b40b-e1bad295e424';
BEGIN

    -- Pré-condição: o asset precisa existir e pertencer ao customer.
    IF NOT EXISTS (
        SELECT 1 FROM assets
        WHERE id = v_asset_id
          AND tenant_id = v_tenant_id
          AND customer_id = v_customer_id
    ) THEN
        RAISE EXCEPTION 'Asset % não encontrado para o customer %', v_asset_id, v_customer_id;
    END IF;

    -- ----------------------------------------------------------------
    -- STEP 1: Central (gateway) — ID fixo
    -- ----------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM centrals WHERE id = v_central_id) THEN
        INSERT INTO centrals (
            id, tenant_id, customer_id, asset_id,
            name, display_name, serial_number,
            type, status, connection_status,
            firmware_version, software_version,
            frequency,
            config, stats, location, tags, metadata, version
        ) VALUES (
            v_central_id,
            v_tenant_id,
            v_customer_id,
            v_asset_id,
            'Central Moxuara 2.0 - ENTRADA - TRAFO - 2026-07-13',
            'Central Moxuara 2.0 - ENTRADA - TRAFO - 2026-07-13',
            'MOXUARA-GW-2.0-ENTRADA-TRAFO',
            'GATEWAY', 'ACTIVE', 'OFFLINE',
            '1.0.0', '5.2.0',
            60,
            '{}', '{}', '{}', '[]', '{}', 1
        );
        RAISE NOTICE 'Central criada. ID = %', v_central_id;
    ELSE
        RAISE NOTICE 'Central já existia. ID = %', v_central_id;
    END IF;

    -- ----------------------------------------------------------------
    -- STEP 2: Device slave 1 — CAG Entrada
    -- ----------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM devices
        WHERE tenant_id = v_tenant_id AND central_id = v_central_id AND slave_id = 1
    ) THEN
        INSERT INTO devices (
            id, tenant_id, customer_id, asset_id, central_id,
            name, display_name, label,
            type, serial_number, identifier,
            slave_id,
            device_profile, device_type,
            status, connectivity_status,
            specs, tags, metadata, attributes,
            version, created_at, updated_at
        ) VALUES (
            gen_random_uuid(),
            v_tenant_id, v_customer_id, v_asset_id, v_central_id,
            '3F SCMoxuara_CAGEntrada x1650 x20A x90.5V',
            'CAG Entrada',
            'CAG Entrada',
            'METER',
            '3F SCMoxuara_CAGEntrada x1650 x20A x90.5V',
            '3F SCMoxuara_CAGEntrada x1650 x20A x90.5V',
            1,
            '3F_MEDIDOR', '3F_MEDIDOR',
            'ACTIVE', 'UNKNOWN',
            '{"ct":1650,"currentA":20,"voltageV":90.5}',
            '[]', '{}', '{}',
            1, NOW(), NOW()
        );
        RAISE NOTICE 'Device slave 1 (CAG Entrada) criado.';
    ELSE
        RAISE NOTICE 'Device slave 1 já existia na central %.', v_central_id;
    END IF;

    -- ----------------------------------------------------------------
    -- STEP 3: Device slave 2 — Trafo Entrada L2 (Condomínio)
    -- ----------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM devices
        WHERE tenant_id = v_tenant_id AND central_id = v_central_id AND slave_id = 2
    ) THEN
        INSERT INTO devices (
            id, tenant_id, customer_id, asset_id, central_id,
            name, display_name, label,
            type, serial_number, identifier,
            slave_id,
            device_profile, device_type,
            status, connectivity_status,
            specs, tags, metadata, attributes,
            version, created_at, updated_at
        ) VALUES (
            gen_random_uuid(),
            v_tenant_id, v_customer_id, v_asset_id, v_central_id,
            '3F SCMOXUARAAC_Trafo_Entrada_L2 x1650 x20A x90.5V',
            'Trafo Entrada L2',
            'Trafo Entrada L2',
            'METER',
            '3F SCMOXUARAAC_Trafo_Entrada_L2 x1650 x20A x90.5V',
            '3F SCMOXUARAAC_Trafo_Entrada_L2 x1650 x20A x90.5V',
            2,
            '3F_MEDIDOR', '3F_MEDIDOR',
            'ACTIVE', 'UNKNOWN',
            '{"ct":1650,"currentA":20,"voltageV":90.5}',
            '[]', '{}', '{}',
            1, NOW(), NOW()
        );
        RAISE NOTICE 'Device slave 2 (Trafo Entrada L2) criado.';
    ELSE
        RAISE NOTICE 'Device slave 2 já existia na central %.', v_central_id;
    END IF;

    -- ----------------------------------------------------------------
    -- STEP 4: Colunas de RFC, aplicadas só se a migration já rodou
    --
    -- meter_role / meter_domain  -> migration 0061 (RFC-0046 Addendum A)
    -- tariff_category            -> migration 0062 (RFC-0054)
    --
    -- Em bancos onde 0061/0062 ainda não rodaram, os devices ficam criados
    -- sem classificação e este bloco vira no-op. Depois de aplicar as
    -- migrations, basta reexecutar este script: as guardas acima impedem
    -- duplicação e os UPDATEs abaixo passam a valer.
    -- ----------------------------------------------------------------
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'devices' AND column_name = 'meter_role'
    ) THEN
        EXECUTE format(
            'UPDATE devices SET meter_role = %L, meter_domain = %L,
                    updated_at = NOW(), version = version + 1
               WHERE tenant_id = %L AND central_id = %L AND slave_id IN (1, 2)
                 AND meter_role IS DISTINCT FROM %L',
            'ENTRY', 'ENERGY', v_tenant_id, v_central_id, 'ENTRY'
        );
        RAISE NOTICE 'meter_role/meter_domain aplicados (migration 0061 presente).';
    ELSE
        RAISE NOTICE 'PULADO: meter_role/meter_domain — migration 0061 não aplicada.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'devices' AND column_name = 'tariff_category'
    ) THEN
        EXECUTE format(
            'UPDATE devices SET tariff_category = %L,
                    updated_at = NOW(), version = version + 1
               WHERE tenant_id = %L AND central_id = %L AND slave_id IN (1, 2)
                 AND tariff_category IS DISTINCT FROM %L',
            'COMMON_AREA', v_tenant_id, v_central_id, 'COMMON_AREA'
        );
        RAISE NOTICE 'tariff_category aplicado (migration 0062 presente).';
    ELSE
        RAISE NOTICE 'PULADO: tariff_category — migration 0062 não aplicada.';
    END IF;

END $$;

-- ----------------------------------------------------------------
-- Verificação
-- ----------------------------------------------------------------
SELECT id, name, serial_number, type, status, connection_status, asset_id, frequency
FROM centrals
WHERE id = '6d7cd66a-c6dd-40df-b40b-e1bad295e424';

SELECT id, slave_id, name, display_name, type, status, asset_id, specs
FROM devices
WHERE tenant_id  = '11111111-1111-1111-1111-111111111111'
  AND central_id = '6d7cd66a-c6dd-40df-b40b-e1bad295e424'
ORDER BY slave_id;

-- Classificação RFC (rodar só depois das migrations 0061 / 0062):
-- SELECT id, slave_id, display_name, meter_role, meter_domain, tariff_category
-- FROM devices
-- WHERE tenant_id  = '11111111-1111-1111-1111-111111111111'
--   AND central_id = '6d7cd66a-c6dd-40df-b40b-e1bad295e424'
-- ORDER BY slave_id;
