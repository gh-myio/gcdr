-- =============================================================================
-- FIX: divergência external_id x metadata.tbId (verificado no TB em 2026-07-14)
-- =============================================================================
-- Veredito por consulta ao banco do ThingsBoard (nome + telemetria):
--   * 24 Moxuara (23 HIDR + 3F Q103L1): metadata.tbId é o device TB correto;
--     external_id apontava para o GÊMEO 3F do mesmo ponto (ou para um "_2.old").
--     -> external_id := metadata.tbId
--   * 1 SMS (3F SCMS AC-Geral_Trafo3): direção OPOSTA — external_id aponta para
--     o device recriado (telemetria atual); metadata.tbId para o morto.
--     -> metadata.tbId := external_id
--   * 1 DEV. DevicesSemAsset... : lixo de teste, fica para a limpeza de teste.
--
-- Cada UPDATE é guardado pelo valor ATUAL errado (id + valor); se o estado
-- mudou desde a verificação, o UPDATE no-opa e a asserção final aborta tudo.
-- =============================================================================

BEGIN;

-- Moxuara: external_id recebe o TB id correto (o que casa com o nome)
UPDATE devices SET external_id = '20b0c340-b4de-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '6577656c-23da-41bd-83b3-9f5342ba19ce' AND external_id = '215ae5f0-b4de-11f0-be7f-e760d1498268'; -- 3F SCMOXUARAQ103L1
UPDATE devices SET external_id = '698bb120-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '6c511dd7-ba09-4b12-a679-8cf1cc1e103c' AND external_id = '68e278d0-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA203CL2
UPDATE devices SET external_id = 'e599f650-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '2ab2d485-4fd4-4f71-a465-1916ac716d23' AND external_id = 'e4ea5560-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA209AL2
UPDATE devices SET external_id = 'eefe7130-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'c14d2acb-c393-4e50-817c-41bef2689b11' AND external_id = 'ee520490-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA209JKL2
UPDATE devices SET external_id = 'a59394d0-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'fa0e24f3-e50a-4cb0-8e8c-47d92a627407' AND external_id = 'a4e04a60-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA301EFL3
UPDATE devices SET external_id = 'ac7a8c90-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '58bbf0e0-be58-44f7-8052-de96a21e8274' AND external_id = 'abcdf8e0-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA305JL3
UPDATE devices SET external_id = 'b2a9f420-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '76d510dd-1e26-406f-b545-c08daa7366c5' AND external_id = 'b1ffd170-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA307GHIL3
UPDATE devices SET external_id = 'ec60e2f0-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '80f37a3b-80ac-47c5-bd13-59456b7b5a83' AND external_id = 'ebade6a0-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA309PL3
UPDATE devices SET external_id = 'c0bb0720-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'bb4f9ab4-53fa-49d9-8dd8-b9be31d87df2' AND external_id = 'c0109650-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA312NOL3
UPDATE devices SET external_id = 'c7576150-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'a85e07c5-9b13-4f29-97b1-e45d9f8e995b' AND external_id = 'c6a6fd10-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA313DL3
UPDATE devices SET external_id = 'ca9af390-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'adb92c87-a30a-4d94-8b33-d7021fce479c' AND external_id = 'c9f31ad0-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA314ABCL3
UPDATE devices SET external_id = 'e203fe50-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '4f55547e-07b1-48c0-a73c-31501d4c5a38' AND external_id = 'e15c4ca0-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA314EL3
UPDATE devices SET external_id = 'cde1ba20-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '2ead4c19-cd22-4e88-b35d-3135e491d6ea' AND external_id = 'cd37e590-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA315A1A2L3
UPDATE devices SET external_id = 'd2da4f60-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '026943d3-1808-4828-8793-4b12180b8a9f' AND external_id = 'd22bbfe0-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA315CL3
UPDATE devices SET external_id = 'd4812190-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '95ab414f-8563-405c-ae96-17e6ed5f81c7' AND external_id = 'd3d50310-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA315DEL3
UPDATE devices SET external_id = 'd6281ad0-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'd5b8edfc-616a-4d76-9cfd-dab352c3bb71' AND external_id = 'd57dd110-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA315FL3
UPDATE devices SET external_id = 'db1abca0-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'ca77a5f1-ece2-4c83-a5cc-e7013187b5e8' AND external_id = 'da648c00-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA316GL3
UPDATE devices SET external_id = 'dcc05650-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'ecf3e46e-3067-45ae-a031-2c0953bafc75' AND external_id = 'dc128a20-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARA316IL3
UPDATE devices SET external_id = '11f28050-b4de-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '956aef64-d33e-4936-8f36-56071fa72480' AND external_id = '1146fe10-b4de-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARAQ101L1
UPDATE devices SET external_id = '0ac271a0-b4de-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '5d49bb2c-6845-453e-b767-71475bd639de' AND external_id = '0a18eb30-b4de-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARAQ104BL1
UPDATE devices SET external_id = 'f9cbcae0-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'cdd47a28-17df-4769-936b-43b5e4d4a246' AND external_id = 'f8be7990-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARAQ105L1
UPDATE devices SET external_id = 'f4586050-b4dd-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'e819ac7a-8096-43cd-b0bb-ae40d4b9a0f2' AND external_id = 'f3a8e670-b4dd-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARAQ214L2
UPDATE devices SET external_id = '139c11a0-b4de-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = 'eab8d8e1-a7d2-4932-be1c-ac044b71093f' AND external_id = '12f10490-b4de-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARAQ215L2
UPDATE devices SET external_id = '10571fd0-b4de-11f0-be7f-e760d1498268', updated_at = now(), version = version + 1
WHERE id = '0c6577f9-fe00-47cf-83ab-b084117707f7' AND external_id = '0f981590-b4de-11f0-be7f-e760d1498268'; -- HIDR. SCMOXUARAQ315L3

-- SMS Trafo3: metadata.tbId recebe o TB id vivo (recriação de 2026-03-09)
UPDATE devices SET metadata = jsonb_set(metadata, '{tbId}', to_jsonb('b14990d0-1c17-11f1-85dc-691a3eba4797'::text)), updated_at = now(), version = version + 1
WHERE id = 'b68eafee-600a-4b6a-ba05-d500d949d917' AND metadata->>'tbId' = '52e8df70-d11f-11f0-998e-25174baff087'; -- 3F SCMS AC-Geral_Trafo3

-- Asserção: os 25 corrigidos precisam estar consistentes agora
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM devices
  WHERE id IN ('6577656c-23da-41bd-83b3-9f5342ba19ce', 'b68eafee-600a-4b6a-ba05-d500d949d917', '6c511dd7-ba09-4b12-a679-8cf1cc1e103c', '2ab2d485-4fd4-4f71-a465-1916ac716d23', 'c14d2acb-c393-4e50-817c-41bef2689b11', 'fa0e24f3-e50a-4cb0-8e8c-47d92a627407', '58bbf0e0-be58-44f7-8052-de96a21e8274', '76d510dd-1e26-406f-b545-c08daa7366c5', '80f37a3b-80ac-47c5-bd13-59456b7b5a83', 'bb4f9ab4-53fa-49d9-8dd8-b9be31d87df2', 'a85e07c5-9b13-4f29-97b1-e45d9f8e995b', 'adb92c87-a30a-4d94-8b33-d7021fce479c', '4f55547e-07b1-48c0-a73c-31501d4c5a38', '2ead4c19-cd22-4e88-b35d-3135e491d6ea', '026943d3-1808-4828-8793-4b12180b8a9f', '95ab414f-8563-405c-ae96-17e6ed5f81c7', 'd5b8edfc-616a-4d76-9cfd-dab352c3bb71', 'ca77a5f1-ece2-4c83-a5cc-e7013187b5e8', 'ecf3e46e-3067-45ae-a031-2c0953bafc75', '956aef64-d33e-4936-8f36-56071fa72480', '5d49bb2c-6845-453e-b767-71475bd639de', 'cdd47a28-17df-4769-936b-43b5e4d4a246', 'e819ac7a-8096-43cd-b0bb-ae40d4b9a0f2', 'eab8d8e1-a7d2-4932-be1c-ac044b71093f', '0c6577f9-fe00-47cf-83ab-b084117707f7')
    AND metadata->>'tbId' IS DISTINCT FROM external_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORTADO: % device(s) ainda divergentes após o fix', n;
  END IF;
  RAISE NOTICE 'fix aplicado: 25 devices consistentes';
END $$;

-- Conferência de colisão: nenhum external_id pode apontar para o mesmo TB
-- device que outro registro (se aparecer linha aqui, os gêmeos 3F também
-- estão com mapeamento errado e precisam da própria rodada)
SELECT external_id, count(*) AS qtd, array_agg(name ORDER BY name) AS devices
FROM devices
WHERE deleted_at IS NULL AND external_id IS NOT NULL
GROUP BY external_id
HAVING count(*) > 1;

COMMIT;
