-- =============================================================================
-- OPS: (A) Asset próprio para o CAG Entrada + (B) baixa dos medidores OLD
--
-- Tenant        : 11111111-1111-1111-1111-111111111111
-- Customer      : 84e0370e-636a-4741-9874-504b5e0b3577  (Moxuara / SMO)
-- Central NOVA  : 6d7cd66a-c6dd-40df-b40b-e1bad295e424
-- Central ANTIGA: e982edf9-edb1-4aa6-8a14-4782465ae5a3
--
-- Contexto: os 2 medidores de entrada já vivem na central nova
--   slave 1 = 3077a33a-8bd2-4f4f-bae4-68c003f20fcf  (CAG)
--   slave 2 = 2c41a66a-1c38-4cc3-9373-c6f1c85f0a6c  (Trafo / Condomínio)
-- O slave 2 tem asset próprio (SCMOXUARAAC_TRAFO_ENTRADA_L2); o slave 1 está
-- no placeholder "DevicesSemAssetConfiguradoMoxuara". A PARTE A corrige isso.
--
-- PARTE A é idempotente e segura. PARTE B altera device existente — leia antes.
-- =============================================================================


-- #############################################################################
-- PARTE A — Asset próprio para o CAG Entrada
--
-- Espelha o padrão do asset do Trafo: depth 0, parent NULL, type OTHER.
-- (A árvore de assets do Moxuara é plana — todos os assets estão em depth 0.)
-- #############################################################################

DO $$
DECLARE
    v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
    v_customer_id UUID := '84e0370e-636a-4741-9874-504b5e0b3577';
    v_device_id   UUID := '3077a33a-8bd2-4f4f-bae4-68c003f20fcf';
    v_asset_code  TEXT := 'SCMOXUARA_CAG_ENTRADA';
    v_asset_id    UUID;
    v_old_asset   UUID;
BEGIN
    -- Reaproveita o asset se já existir (idempotência).
    SELECT id INTO v_asset_id
    FROM assets
    WHERE tenant_id = v_tenant_id
      AND customer_id = v_customer_id
      AND code = v_asset_code;

    IF v_asset_id IS NULL THEN
        v_asset_id := gen_random_uuid();

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
            '/' || v_tenant_id || '/' || v_customer_id || '/' || v_asset_id,
            0,
            'SCMOXUARA_CAG_ENTRADA',
            'CAG_Entrada',
            v_asset_code,
            'OTHER',
            '{}', '{}', '[]', '{}',
            'ACTIVE', 1
        );
        RAISE NOTICE 'PARTE A: asset criado. ID = %', v_asset_id;
    ELSE
        RAISE NOTICE 'PARTE A: asset já existia. ID = %', v_asset_id;
    END IF;

    -- Reaponta o device do placeholder para o asset novo.
    SELECT asset_id INTO v_old_asset FROM devices WHERE id = v_device_id;

    IF v_old_asset IS NULL THEN
        RAISE EXCEPTION 'PARTE A: device % não encontrado', v_device_id;
    ELSIF v_old_asset = v_asset_id THEN
        RAISE NOTICE 'PARTE A: device já estava no asset correto — nada a fazer.';
    ELSE
        UPDATE devices
        SET asset_id   = v_asset_id,
            updated_at = NOW(),
            version    = version + 1
        WHERE id = v_device_id;

        RAISE NOTICE 'PARTE A: device % movido de % para %',
                     v_device_id, v_old_asset, v_asset_id;
    END IF;
END $$;


-- Verificação da PARTE A
SELECT d.slave_id, d.display_name, d.asset_id, a.name AS asset_name, a.code, d.version
FROM devices d
JOIN assets a ON a.id = d.asset_id
WHERE d.central_id = '6d7cd66a-c6dd-40df-b40b-e1bad295e424'
ORDER BY d.slave_id;


-- #############################################################################
-- PARTE B — Baixa dos medidores substituídos ("OLD")
--
-- Em campo os medidores antigos foram renomeados com o prefixo 3.F.OLD:
--   slave 191 -> 3.F.OLD SCMOXUARAAC_Trafo_Entrada_L2 x1650 x20A x90.5V
--   slave 325 -> 3.F.OLD SCMoxuara_CAGEntrada x1650 x20A x90.5V
--
-- ATENÇÃO — no GCDR a situação NÃO é simétrica:
--   * slave 191: o UUID 2c41a66a JÁ FOI MOVIDO para a central nova (slave 2).
--     Não existe registro remanescente no GCDR para o 191. Se o sync do TB
--     recriar o "3.F.OLD ..." como device novo, ele entra SEM meter_role e não
--     afeta metas — mas convém conferir depois do próximo sync.
--   * slave 325: idem, não existe no GCDR.
--   * O que EXISTE de fato é da5ea0a1 (SCMoxuaraCAGEntrada), slave_id NULL,
--     ainda na central antiga, no asset "DevicesSemAssetMoxuara".
--
-- B1 é só leitura. Rode B1 ANTES de B2 e confira o que vai ser alterado.
-- #############################################################################

-- ---------------------------------------------------------------------------
-- B1 (LEITURA) — o que existe hoje no GCDR relacionado aos medidores antigos
-- ---------------------------------------------------------------------------
SELECT
    d.id,
    d.name,
    d.display_name,
    d.slave_id,
    d.status,
    d.meter_role,
    d.meter_domain,
    d.central_id,
    d.asset_id,
    d.last_activity_time,
    d.updated_at
FROM devices d
WHERE d.tenant_id = '11111111-1111-1111-1111-111111111111'
  AND d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
  AND d.deleted_at IS NULL
  AND (
        d.id = 'da5ea0a1-0d0a-41fb-a639-75f77b625f8c'  -- SCMoxuaraCAGEntrada
     OR d.name ILIKE '%OLD%'
     OR d.name ILIKE '%CAGEntrada%'
     OR d.name ILIKE '%Trafo_Entrada%'
     OR d.name ILIKE '%CAG P%s Trafo%'                 -- 3F CAG Pós Trafo
     OR d.slave_id IN (191, 325)
  )
ORDER BY d.central_id, d.slave_id NULLS LAST, d.name;

-- Olhe a coluna last_activity_time acima. Se algum desses ainda estiver
-- recebendo telemetria recente, NÃO rode o B2 para ele — investigue antes.


-- ---------------------------------------------------------------------------
-- B2 (ESCRITA) — baixa do da5ea0a1
--
-- O que faz, e por quê:
--   * meter_role/meter_domain = NULL  -> tira o device da alocação residual
--                                        do RFC-0046. ESTE é o passo que
--                                        elimina o risco de dupla contagem.
--   * status = 'INACTIVE'             -> some das listagens operacionais.
--   * name com prefixo 3.F.OLD        -> alinha com a convenção de campo.
--
-- Reversível: para desfazer, volte status='ACTIVE' e o name anterior
-- ('SCMoxuaraCAGEntrada'). Nada é apagado; sem DELETE.
--
-- >>> Descomente o bloco abaixo somente depois de conferir o B1. <<<
-- ---------------------------------------------------------------------------

/*
UPDATE devices
SET name         = '3.F.OLD SCMoxuara_CAGEntrada x1650 x20A x90.5V',
    display_name = 'CAG Entrada (OLD)',
    status       = 'INACTIVE',
    meter_role   = NULL,
    meter_domain = NULL,
    updated_at   = NOW(),
    version      = version + 1
WHERE id        = 'da5ea0a1-0d0a-41fb-a639-75f77b625f8c'
  AND tenant_id = '11111111-1111-1111-1111-111111111111'
  AND status    = 'ACTIVE';   -- no-op se já tiver sido baixado

-- Verificação do B2
SELECT id, name, display_name, status, meter_role, meter_domain, version
FROM devices
WHERE id = 'da5ea0a1-0d0a-41fb-a639-75f77b625f8c';
*/


-- ---------------------------------------------------------------------------
-- B3 (LEITURA) — rede de segurança: quais devices ENTRY/ENERGY existem no
-- customer. Depois de tudo, DEVEM ser exatamente 2 (slaves 1 e 2 da central
-- nova). Qualquer terceiro entra somando na meta.
-- ---------------------------------------------------------------------------
SELECT d.id, d.name, d.slave_id, d.central_id, c.name AS central_name, d.status
FROM devices d
LEFT JOIN centrals c ON c.id = d.central_id
WHERE d.tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND d.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
  AND d.meter_role  = 'ENTRY'
  AND d.meter_domain = 'ENERGY'
  AND d.deleted_at IS NULL
ORDER BY d.central_id, d.slave_id;
