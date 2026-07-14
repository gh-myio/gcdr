-- =============================================================================
-- DEDUP: devices HIDR duplicados do Moxuara (import 09/03 x re-import 11/03)
-- =============================================================================
-- Veredito por atributos no ThingsBoard (2026-07-14): os hidrômetros VIVOS
-- operam nos slaves da faixa alta (242, 300-303) = cópia de 11/03 (profile
-- HIDROMETRO correto). As cópias de 09/03 (slaves na faixa dos 3F, profile
-- 3F_MEDIDOR) são fantasmas do import cruzado -> DELETADAS aqui.
--
-- FORA DESTE SCRIPT: o par "3F SCMOXUARAQ103L1" (slaves 168 x 165) aguarda o
-- mesmo veredito de slave no TB antes de deduplicar.
--
-- Guards: cada DELETE exige id + slave errado + tipo; dry-run confirmou ZERO
-- referências (escopo de WO, anotações, regras) nas cópias fantasma.
-- =============================================================================

BEGIN;

-- Guarda: as 23 fantasmas e as 23 vivas têm que estar presentes como esperado
DO $$
DECLARE na int; nb int;
BEGIN
  SELECT count(*) INTO na FROM devices WHERE id IN ('5d49bb2c-6845-453e-b767-71475bd639de', '0c6577f9-fe00-47cf-83ab-b084117707f7', '956aef64-d33e-4936-8f36-56071fa72480', 'eab8d8e1-a7d2-4932-be1c-ac044b71093f', '6c511dd7-ba09-4b12-a679-8cf1cc1e103c', 'fa0e24f3-e50a-4cb0-8e8c-47d92a627407', '58bbf0e0-be58-44f7-8052-de96a21e8274', '76d510dd-1e26-406f-b545-c08daa7366c5', 'bb4f9ab4-53fa-49d9-8dd8-b9be31d87df2', 'a85e07c5-9b13-4f29-97b1-e45d9f8e995b', 'adb92c87-a30a-4d94-8b33-d7021fce479c', '2ead4c19-cd22-4e88-b35d-3135e491d6ea', '026943d3-1808-4828-8793-4b12180b8a9f', '95ab414f-8563-405c-ae96-17e6ed5f81c7', 'd5b8edfc-616a-4d76-9cfd-dab352c3bb71', 'ca77a5f1-ece2-4c83-a5cc-e7013187b5e8', 'ecf3e46e-3067-45ae-a031-2c0953bafc75', '4f55547e-07b1-48c0-a73c-31501d4c5a38', '2ab2d485-4fd4-4f71-a465-1916ac716d23', '80f37a3b-80ac-47c5-bd13-59456b7b5a83', 'c14d2acb-c393-4e50-817c-41bef2689b11', 'e819ac7a-8096-43cd-b0bb-ae40d4b9a0f2', 'cdd47a28-17df-4769-936b-43b5e4d4a246') AND deleted_at IS NULL;
  SELECT count(*) INTO nb FROM devices WHERE id IN ('32c9ba0b-0ba9-4ca9-82e4-c7f8c292ded6', 'd2c006fa-c111-4dd1-abed-70377b04de4f', 'cf3ba062-d16f-4cdb-ad6e-6cc518c85753', 'c05f2ffb-65f5-481e-9207-2b34afa10079', 'c3cb8913-976f-4578-9349-b96c59657cd9', '034bf4f7-d0ae-46d7-870a-75c6f34bfdac', 'ce0bf16d-90d9-44cc-abea-e2c32c1e0863', 'b16f6735-22b9-4ee1-9f6b-d9298e747e77', '168734a0-118b-4ce8-99c2-2dcbf338e8f1', '1851c3d5-d483-4d45-a136-4cd490a609bd', '7c97e0ca-aa1c-4d8f-a472-3cc1591ab2c9', 'a57afb99-9e64-4bc1-9222-4bf64c797f76', '22406e4c-951a-46db-85da-10eff6877188', 'a2539c99-ea42-4f8c-aa0c-830d5494b7ba', '63fb02c6-fa06-4b01-ac8f-022f39ccaa5d', '359623cf-9f1c-4aef-9612-4250b259090e', '1572dc34-adf6-4b6d-a991-9c2081b5963a', '8c862b8d-4d13-42dd-871a-c08f1180befd', '8efaf874-488e-45a0-9c65-e32d82a39083', '774aa803-3f05-4038-a602-b680b8c33865', '37913ab3-55a0-4ab1-bc2b-258c8f9209fd', 'ee1a4ed4-6a09-4791-8bff-a378c2f62d9a', 'e5549617-6f59-425e-877a-32b1a0ffa4b1') AND deleted_at IS NULL;
  IF na <> 23 OR nb <> 23 THEN
    RAISE EXCEPTION 'ABORTADO: fantasmas=% (esperado 23), vivas=% (esperado 23)', na, nb;
  END IF;
END $$;

-- Higiene defensiva (dry-run diz 0 em tudo; se algo apareceu depois, remove junto)
DELETE FROM work_orders_devices WHERE device_id IN ('5d49bb2c-6845-453e-b767-71475bd639de', '0c6577f9-fe00-47cf-83ab-b084117707f7', '956aef64-d33e-4936-8f36-56071fa72480', 'eab8d8e1-a7d2-4932-be1c-ac044b71093f', '6c511dd7-ba09-4b12-a679-8cf1cc1e103c', 'fa0e24f3-e50a-4cb0-8e8c-47d92a627407', '58bbf0e0-be58-44f7-8052-de96a21e8274', '76d510dd-1e26-406f-b545-c08daa7366c5', 'bb4f9ab4-53fa-49d9-8dd8-b9be31d87df2', 'a85e07c5-9b13-4f29-97b1-e45d9f8e995b', 'adb92c87-a30a-4d94-8b33-d7021fce479c', '2ead4c19-cd22-4e88-b35d-3135e491d6ea', '026943d3-1808-4828-8793-4b12180b8a9f', '95ab414f-8563-405c-ae96-17e6ed5f81c7', 'd5b8edfc-616a-4d76-9cfd-dab352c3bb71', 'ca77a5f1-ece2-4c83-a5cc-e7013187b5e8', 'ecf3e46e-3067-45ae-a031-2c0953bafc75', '4f55547e-07b1-48c0-a73c-31501d4c5a38', '2ab2d485-4fd4-4f71-a465-1916ac716d23', '80f37a3b-80ac-47c5-bd13-59456b7b5a83', 'c14d2acb-c393-4e50-817c-41bef2689b11', 'e819ac7a-8096-43cd-b0bb-ae40d4b9a0f2', 'cdd47a28-17df-4769-936b-43b5e4d4a246');
DELETE FROM annotation_mentions WHERE mentioned_device_id IN ('5d49bb2c-6845-453e-b767-71475bd639de', '0c6577f9-fe00-47cf-83ab-b084117707f7', '956aef64-d33e-4936-8f36-56071fa72480', 'eab8d8e1-a7d2-4932-be1c-ac044b71093f', '6c511dd7-ba09-4b12-a679-8cf1cc1e103c', 'fa0e24f3-e50a-4cb0-8e8c-47d92a627407', '58bbf0e0-be58-44f7-8052-de96a21e8274', '76d510dd-1e26-406f-b545-c08daa7366c5', 'bb4f9ab4-53fa-49d9-8dd8-b9be31d87df2', 'a85e07c5-9b13-4f29-97b1-e45d9f8e995b', 'adb92c87-a30a-4d94-8b33-d7021fce479c', '2ead4c19-cd22-4e88-b35d-3135e491d6ea', '026943d3-1808-4828-8793-4b12180b8a9f', '95ab414f-8563-405c-ae96-17e6ed5f81c7', 'd5b8edfc-616a-4d76-9cfd-dab352c3bb71', 'ca77a5f1-ece2-4c83-a5cc-e7013187b5e8', 'ecf3e46e-3067-45ae-a031-2c0953bafc75', '4f55547e-07b1-48c0-a73c-31501d4c5a38', '2ab2d485-4fd4-4f71-a465-1916ac716d23', '80f37a3b-80ac-47c5-bd13-59456b7b5a83', 'c14d2acb-c393-4e50-817c-41bef2689b11', 'e819ac7a-8096-43cd-b0bb-ae40d4b9a0f2', 'cdd47a28-17df-4769-936b-43b5e4d4a246');

-- As 23 cópias fantasma de 09/03
DELETE FROM devices WHERE id = '5d49bb2c-6845-453e-b767-71475bd639de' AND slave_id = 146 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARAQ104BL1 (fantasma slave 146)
DELETE FROM devices WHERE id = '0c6577f9-fe00-47cf-83ab-b084117707f7' AND slave_id = 151 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARAQ315L3 (fantasma slave 151)
DELETE FROM devices WHERE id = '956aef64-d33e-4936-8f36-56071fa72480' AND slave_id = 152 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARAQ101L1 (fantasma slave 152)
DELETE FROM devices WHERE id = 'eab8d8e1-a7d2-4932-be1c-ac044b71093f' AND slave_id = 153 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARAQ215L2 (fantasma slave 153)
DELETE FROM devices WHERE id = '6c511dd7-ba09-4b12-a679-8cf1cc1e103c' AND slave_id = 16 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA203CL2 (fantasma slave 16)
DELETE FROM devices WHERE id = 'fa0e24f3-e50a-4cb0-8e8c-47d92a627407' AND slave_id = 66 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA301EFL3 (fantasma slave 66)
DELETE FROM devices WHERE id = '58bbf0e0-be58-44f7-8052-de96a21e8274' AND slave_id = 72 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA305JL3 (fantasma slave 72)
DELETE FROM devices WHERE id = '76d510dd-1e26-406f-b545-c08daa7366c5' AND slave_id = 77 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA307GHIL3 (fantasma slave 77)
DELETE FROM devices WHERE id = 'bb4f9ab4-53fa-49d9-8dd8-b9be31d87df2' AND slave_id = 90 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA312NOL3 (fantasma slave 90)
DELETE FROM devices WHERE id = 'a85e07c5-9b13-4f29-97b1-e45d9f8e995b' AND slave_id = 94 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA313DL3 (fantasma slave 94)
DELETE FROM devices WHERE id = 'adb92c87-a30a-4d94-8b33-d7021fce479c' AND slave_id = 96 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA314ABCL3 (fantasma slave 96)
DELETE FROM devices WHERE id = '2ead4c19-cd22-4e88-b35d-3135e491d6ea' AND slave_id = 98 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA315A1A2L3 (fantasma slave 98)
DELETE FROM devices WHERE id = '026943d3-1808-4828-8793-4b12180b8a9f' AND slave_id = 101 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA315CL3 (fantasma slave 101)
DELETE FROM devices WHERE id = '95ab414f-8563-405c-ae96-17e6ed5f81c7' AND slave_id = 102 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA315DEL3 (fantasma slave 102)
DELETE FROM devices WHERE id = 'd5b8edfc-616a-4d76-9cfd-dab352c3bb71' AND slave_id = 103 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA315FL3 (fantasma slave 103)
DELETE FROM devices WHERE id = 'ca77a5f1-ece2-4c83-a5cc-e7013187b5e8' AND slave_id = 106 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA316GL3 (fantasma slave 106)
DELETE FROM devices WHERE id = 'ecf3e46e-3067-45ae-a031-2c0953bafc75' AND slave_id = 107 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA316IL3 (fantasma slave 107)
DELETE FROM devices WHERE id = '4f55547e-07b1-48c0-a73c-31501d4c5a38' AND slave_id = 111 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA314EL3 (fantasma slave 111)
DELETE FROM devices WHERE id = '2ab2d485-4fd4-4f71-a465-1916ac716d23' AND slave_id = 114 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA209AL2 (fantasma slave 114)
DELETE FROM devices WHERE id = '80f37a3b-80ac-47c5-bd13-59456b7b5a83' AND slave_id = 119 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA309PL3 (fantasma slave 119)
DELETE FROM devices WHERE id = 'c14d2acb-c393-4e50-817c-41bef2689b11' AND slave_id = 121 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARA209JKL2 (fantasma slave 121)
DELETE FROM devices WHERE id = 'e819ac7a-8096-43cd-b0bb-ae40d4b9a0f2' AND slave_id = 126 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARAQ214L2 (fantasma slave 126)
DELETE FROM devices WHERE id = 'cdd47a28-17df-4769-936b-43b5e4d4a246' AND slave_id = 130 AND device_type = 'HIDROMETRO'; -- HIDR. SCMOXUARAQ105L1 (fantasma slave 130)

-- Pós-verificação
DO $$
DECLARE resto int; dups int;
BEGIN
  SELECT count(*) INTO resto FROM devices WHERE id IN ('5d49bb2c-6845-453e-b767-71475bd639de', '0c6577f9-fe00-47cf-83ab-b084117707f7', '956aef64-d33e-4936-8f36-56071fa72480', 'eab8d8e1-a7d2-4932-be1c-ac044b71093f', '6c511dd7-ba09-4b12-a679-8cf1cc1e103c', 'fa0e24f3-e50a-4cb0-8e8c-47d92a627407', '58bbf0e0-be58-44f7-8052-de96a21e8274', '76d510dd-1e26-406f-b545-c08daa7366c5', 'bb4f9ab4-53fa-49d9-8dd8-b9be31d87df2', 'a85e07c5-9b13-4f29-97b1-e45d9f8e995b', 'adb92c87-a30a-4d94-8b33-d7021fce479c', '2ead4c19-cd22-4e88-b35d-3135e491d6ea', '026943d3-1808-4828-8793-4b12180b8a9f', '95ab414f-8563-405c-ae96-17e6ed5f81c7', 'd5b8edfc-616a-4d76-9cfd-dab352c3bb71', 'ca77a5f1-ece2-4c83-a5cc-e7013187b5e8', 'ecf3e46e-3067-45ae-a031-2c0953bafc75', '4f55547e-07b1-48c0-a73c-31501d4c5a38', '2ab2d485-4fd4-4f71-a465-1916ac716d23', '80f37a3b-80ac-47c5-bd13-59456b7b5a83', 'c14d2acb-c393-4e50-817c-41bef2689b11', 'e819ac7a-8096-43cd-b0bb-ae40d4b9a0f2', 'cdd47a28-17df-4769-936b-43b5e4d4a246');
  IF resto > 0 THEN
    RAISE EXCEPTION 'ABORTADO: % fantasma(s) sobraram', resto;
  END IF;
  SELECT count(*) INTO dups FROM (
    SELECT external_id FROM devices
    WHERE deleted_at IS NULL AND external_id IS NOT NULL
    GROUP BY external_id HAVING count(*) > 1
  ) x;
  RAISE NOTICE 'dedup ok: 23 fantasmas removidos; external_ids ainda duplicados: % (esperado 1 = Q103L1 pendente)', dups;
END $$;

COMMIT;

-- Depois do COMMIT: invalidar o cache do bundle do Moxuara (o bundle é montado
-- do registro de devices e este script mexeu nele por fora dos services):
--   DELETE https://gcdr-api.a.myio-bas.com/api/v1/customers/84e0370e-636a-4741-9874-504b5e0b3577/alarm-rules/bundle/cache
