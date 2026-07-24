-- =============================================================================
-- CONFERÊNCIA (SOMENTE LEITURA) — Central / Asset / Device — Moxuara (SMO)
--
-- Nenhum INSERT/UPDATE/DELETE. Pode rodar em produção à vontade.
--
-- Tenant        : 11111111-1111-1111-1111-111111111111
-- Customer      : 84e0370e-636a-4741-9874-504b5e0b3577  (Moxuara)
-- Central NOVA  : 6d7cd66a-c6dd-40df-b40b-e1bad295e424
-- Central ANTIGA: e982edf9-edb1-4aa6-8a14-4782465ae5a3
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Q1. A central nova existe? Em qual asset ela está?
-- -----------------------------------------------------------------------------
SELECT
    c.id,
    c.name,
    c.serial_number,
    c.type,
    c.status,
    c.connection_status,
    c.asset_id,
    a.name        AS asset_name,
    a.code        AS asset_code,
    a.type        AS asset_type,
    c.created_at,
    c.updated_at
FROM centrals c
LEFT JOIN assets a ON a.id = c.asset_id
WHERE c.id IN (
    '6d7cd66a-c6dd-40df-b40b-e1bad295e424',   -- nova
    'e982edf9-edb1-4aa6-8a14-4782465ae5a3'    -- antiga
);


-- -----------------------------------------------------------------------------
-- Q2. Todas as centrais do customer (para ver se há outras além dessas duas)
-- -----------------------------------------------------------------------------
SELECT
    c.id,
    c.name,
    c.serial_number,
    c.status,
    c.asset_id,
    COUNT(d.id) AS qtd_devices
FROM centrals c
LEFT JOIN devices d
       ON d.central_id = c.id
      AND d.deleted_at IS NULL
WHERE c.tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND c.customer_id = '84e0370e-636a-4741-9874-504b5e0b3577'
GROUP BY c.id, c.name, c.serial_number, c.status, c.asset_id
ORDER BY qtd_devices DESC, c.name;


-- -----------------------------------------------------------------------------
-- Q3. Devices da central NOVA, com o asset de cada um resolvido
--     (é aqui que se vê se o device está no asset "certo")
-- -----------------------------------------------------------------------------
SELECT
    d.slave_id,
    d.id                AS device_id,
    d.name,
    d.display_name,
    d.identifier,
    d.device_profile,
    d.device_type,
    d.type,
    d.status,
    d.serial_number,
    d.external_id,
    d.specs,
    d.asset_id,
    a.name              AS asset_name,
    a.code              AS asset_code,
    a.type              AS asset_type,
    a.parent_asset_id,
    d.version,
    d.updated_at
FROM devices d
LEFT JOIN assets a ON a.id = d.asset_id
WHERE d.tenant_id  = '11111111-1111-1111-1111-111111111111'
  AND d.central_id = '6d7cd66a-c6dd-40df-b40b-e1bad295e424'
  AND d.deleted_at IS NULL
ORDER BY d.slave_id;


-- -----------------------------------------------------------------------------
-- Q4. O que sobrou na central ANTIGA (checar se a migração foi parcial)
-- -----------------------------------------------------------------------------
SELECT
    d.slave_id,
    d.id AS device_id,
    d.name,
    d.display_name,
    d.identifier,
    d.device_profile,
    d.status,
    d.asset_id
FROM devices d
WHERE d.tenant_id  = '11111111-1111-1111-1111-111111111111'
  AND d.central_id = 'e982edf9-edb1-4aa6-8a14-4782465ae5a3'
  AND d.deleted_at IS NULL
ORDER BY d.slave_id;


-- -----------------------------------------------------------------------------
-- Q5. Os assets citados pelos 2 devices — onde eles estão na árvore
-- -----------------------------------------------------------------------------
SELECT
    a.id,
    a.name,
    a.display_name,
    a.code,
    a.type,
    a.depth,
    a.parent_asset_id,
    p.name AS parent_name,
    a.path
FROM assets a
LEFT JOIN assets p ON p.id = a.parent_asset_id
WHERE a.id IN (
    '9ebf5cfc-7cd8-4fec-98ff-142a6dbb2a4a',   -- asset do CAG Entrada
    'afc3a51c-4bc0-4c7b-b9e8-25b7850446e2',   -- asset do Trafo Entrada L2
    '2a257caa-a184-4304-9561-adf8e21814ca',   -- Central_Asset_Moxuara (o que eu havia assumido)
    '8a9c669b-855f-4c2f-bd60-e0541238b980'    -- asset do Trafo em mar/2026 (mudou desde então)
);


-- -----------------------------------------------------------------------------
-- Q6. Busca pelos 2 devices por ID e por nome — independente de central.
--     Confirma que não existem duplicatas em outra central.
-- -----------------------------------------------------------------------------
SELECT
    d.id,
    d.name,
    d.display_name,
    d.slave_id,
    d.central_id,
    c.name AS central_name,
    d.asset_id,
    d.status,
    d.deleted_at
FROM devices d
LEFT JOIN centrals c ON c.id = d.central_id
WHERE d.tenant_id = '11111111-1111-1111-1111-111111111111'
  AND (
        d.id IN (
            '3077a33a-8bd2-4f4f-bae4-68c003f20fcf',
            '2c41a66a-1c38-4cc3-9373-c6f1c85f0a6c'
        )
     OR d.name ILIKE '%CAGEntrada%'
     OR d.name ILIKE '%Trafo_Entrada%'
  )
ORDER BY d.name, d.slave_id;


-- -----------------------------------------------------------------------------
-- Q7. Quais migrations de metas/tarifas já rodaram neste banco
--     (0061 = meter_role/meter_domain, 0062 = tariff_category)
-- -----------------------------------------------------------------------------
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'devices'
  AND column_name IN ('meter_role', 'meter_domain', 'tariff_category', 'channel')
ORDER BY column_name;
