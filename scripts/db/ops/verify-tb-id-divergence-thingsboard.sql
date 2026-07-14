-- Verificação no banco do THINGSBOARD: qual dos dois UUIDs de cada device
-- GCDR divergente é o vivo. Fonte: GCDR dry-run 2026-07-14 (26 devices).
--
-- PERFORMANCE: usa ts_kv_latest (1 linha por entidade x chave, indexada) em vez
-- de ts_kv (bilhões de linhas — max(ts) lá faz full scan e trava a query).

WITH candidatos(gcdr_name, campo, tb_id) AS (
  VALUES
    ('3F SCMOXUARAQ103L1','external_id','215ae5f0-b4de-11f0-be7f-e760d1498268'::uuid),
    ('3F SCMOXUARAQ103L1','metadata.tbId','20b0c340-b4de-11f0-be7f-e760d1498268'::uuid),
    ('3F SCMS AC-Geral_Trafo3','external_id','b14990d0-1c17-11f1-85dc-691a3eba4797'::uuid),
    ('3F SCMS AC-Geral_Trafo3','metadata.tbId','52e8df70-d11f-11f0-998e-25174baff087'::uuid),
    ('DEV. DevicesSemAssetMont_Serrat_QAH3J67','external_id','3cc68df0-a93d-11f0-afe1-175479a33d89'::uuid),
    ('DEV. DevicesSemAssetMont_Serrat_QAH3J67','metadata.tbId','83744320-9f9a-11f0-afe1-175479a33d89'::uuid),
    ('HIDR. SCMOXUARA203CL2','external_id','68e278d0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA203CL2','metadata.tbId','698bb120-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA209AL2','external_id','e4ea5560-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA209AL2','metadata.tbId','e599f650-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA209JKL2','external_id','ee520490-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA209JKL2','metadata.tbId','eefe7130-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA301EFL3','external_id','a4e04a60-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA301EFL3','metadata.tbId','a59394d0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA305JL3','external_id','abcdf8e0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA305JL3','metadata.tbId','ac7a8c90-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA307GHIL3','external_id','b1ffd170-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA307GHIL3','metadata.tbId','b2a9f420-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA309PL3','external_id','ebade6a0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA309PL3','metadata.tbId','ec60e2f0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA312NOL3','external_id','c0109650-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA312NOL3','metadata.tbId','c0bb0720-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA313DL3','external_id','c6a6fd10-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA313DL3','metadata.tbId','c7576150-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA314ABCL3','external_id','c9f31ad0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA314ABCL3','metadata.tbId','ca9af390-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA314EL3','external_id','e15c4ca0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA314EL3','metadata.tbId','e203fe50-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA315A1A2L3','external_id','cd37e590-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA315A1A2L3','metadata.tbId','cde1ba20-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA315CL3','external_id','d22bbfe0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA315CL3','metadata.tbId','d2da4f60-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA315DEL3','external_id','d3d50310-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA315DEL3','metadata.tbId','d4812190-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA315FL3','external_id','d57dd110-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA315FL3','metadata.tbId','d6281ad0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA316GL3','external_id','da648c00-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA316GL3','metadata.tbId','db1abca0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA316IL3','external_id','dc128a20-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARA316IL3','metadata.tbId','dcc05650-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ101L1','external_id','1146fe10-b4de-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ101L1','metadata.tbId','11f28050-b4de-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ104BL1','external_id','0a18eb30-b4de-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ104BL1','metadata.tbId','0ac271a0-b4de-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ105L1','external_id','f8be7990-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ105L1','metadata.tbId','f9cbcae0-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ214L2','external_id','f3a8e670-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ214L2','metadata.tbId','f4586050-b4dd-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ215L2','external_id','12f10490-b4de-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ215L2','metadata.tbId','139c11a0-b4de-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ315L3','external_id','0f981590-b4de-11f0-be7f-e760d1498268'::uuid),
    ('HIDR. SCMOXUARAQ315L3','metadata.tbId','10571fd0-b4de-11f0-be7f-e760d1498268'::uuid)
)
SELECT c.gcdr_name, c.campo, c.tb_id,
       d.name AS tb_name,
       to_timestamp(d.created_time/1000.0) AS tb_created,
       (SELECT to_timestamp(max(l.ts)/1000.0)
          FROM ts_kv_latest l WHERE l.entity_id = d.id) AS ultima_telemetria
FROM candidatos c
LEFT JOIN device d ON d.id = c.tb_id
ORDER BY c.gcdr_name, c.campo;

-- ── Alternativa mínima (se ainda pesar): só existência + nome + criação ──
-- WITH candidatos(gcdr_name, campo, tb_id) AS (VALUES ... )
-- SELECT c.gcdr_name, c.campo, c.tb_id, d.name AS tb_name,
--        to_timestamp(d.created_time/1000.0) AS tb_created
-- FROM candidatos c LEFT JOIN device d ON d.id = c.tb_id
-- ORDER BY c.gcdr_name, c.campo;
