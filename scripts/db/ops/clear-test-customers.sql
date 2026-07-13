-- =============================================================================
-- LIMPEZA DERIVATION-COMPLETE: customers de teste + TUDO derivado deles
-- Fonte: dry-run 2026-07-13 (logs/032-dryRunClearTestCustomers.log) — 66
-- customers (13 word, 52 contains, 1 dragged). IDs HARDCODED.
--
-- "Derivado" = alcançável a partir dos customers por QUALQUER vínculo, não só
-- customer_id (inspirado no cleanup-ingestion-teste.sql do presetup):
--   _assets   = assets dos alvos
--   _centrals = centrais dos alvos OU instaladas em _assets
--   _devices  = devices dos alvos OU pendurados em _assets OU em _centrals
--               (pega devices com customer_id inconsistente de syncs de teste)
--
-- Ordem (FKs): guarda users → detach de escopo de WO alheio → work_orders →
-- filhos de centrais → anotações/menções por device → devices → centrais →
-- assets → satélites → customers (cascades: templates, channels, goals,
-- wo_customer_settings).
--
-- Transacional e idempotente. Qualquer divergência → a transação aborta.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _alvo (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _alvo (id) VALUES
  ('03d3c9f0-187e-41c0-b235-6d1802dd3bb2'::uuid) /* Shopping teste 2 [word] */,
  ('03e93868-593c-4165-9762-929588b96bb9'::uuid) /* teste 0806_3 [word] */,
  ('15077768-e9fa-443d-8d44-cda1fe5ade3f'::uuid) /* Rafael Faria [word] */,
  ('1f785020-2199-46b7-a02a-9dedab006ca1'::uuid) /* Teste Cliente 19-05-2026 19-08 [word] */,
  ('27cad146-73c6-4177-a07b-9dbded499b05'::uuid) /* Teste Cliente 20-05-2026 00-41 [word] */,
  ('34107809-8cc6-43ac-8430-bf6d038b5cb8'::uuid) /* Teste Cliente 09-06-2026 17-36 [word] */,
  ('3d51fb80-2cf7-4554-b224-a546e3c1151a'::uuid) /* Rodrigo Teste Cliente 25-05-2026 15-50 [word] */,
  ('4d343f1e-3d76-4d2c-8807-d4fb6fd5275f'::uuid) /* Teste Cliente 09-06-2026 16-59 [word] */,
  ('5c855a9b-42e0-465c-9b58-4f4b91bcec7c'::uuid) /* teste 0806 [word] */,
  ('6ed6de47-02fa-421f-a690-67f576189aab'::uuid) /* Shopping Teste 19-05 [word] */,
  ('7aab2480-dd3b-442e-abda-d471704f26c4'::uuid) /* MESTRE ALVARO TESTE 1 [word] */,
  ('e80a8ca0-74c5-4848-ac14-23d2bc460e6b'::uuid) /* Teste Cliente 10-06-2026 10-51 [word] */,
  ('f369663e-b74d-4fd0-9c8b-9f45e38a5269'::uuid) /* cliente testes 01 jun [word] */,
  ('0cec2bc3-28a6-45a3-8483-58aa066aa7fc'::uuid) /* TestePreSetup10 [contains] */,
  ('10d7f2a9-d552-44b9-aa5d-2a5f8ff7cedd'::uuid) /* TESTE_16_06_1 [contains] */,
  ('136333b6-f8a4-4770-883d-1de129d8793f'::uuid) /* TESTENOVO7_10_06 [contains] */,
  ('145d7b65-c5e0-416e-ad5e-3fd59a0023e3'::uuid) /* TESTENOVO9_10_06 [contains] */,
  ('179edc57-2d08-4a71-b8c5-40846901574c'::uuid) /* TESTE22_10_06 [contains] */,
  ('1c3763cc-f801-485a-a2bd-9799c907192a'::uuid) /* TESTENOVO8_10_06 [contains] */,
  ('1cd86fbc-9f7a-4f08-8c7a-1f8a988e0a38'::uuid) /* TESTE05 [contains] */,
  ('1e07b442-0d46-4868-854a-e22804e8674d'::uuid) /* TESTENOVO19_10_06 [contains] */,
  ('29b1d5cc-1096-4287-8757-e092685b5caa'::uuid) /* TestePreSetup03 [contains] */,
  ('2ef5695f-b260-4fbc-bd65-23fbd2739395'::uuid) /* TESTENOVO11_10_06 [contains] */,
  ('3ba694dd-eaf4-45b3-966d-760ff3f529d0'::uuid) /* teste10_06 [contains] */,
  ('3f7f1c97-8e20-4f72-8ec7-1c4e42af1bc5'::uuid) /* teste0806_2 [contains] */,
  ('41e4652f-ab25-4b79-8f5c-3a55ac8ec387'::uuid) /* TesteSinc1 [contains] */,
  ('4257d97f-23af-4239-b303-925d47e5a614'::uuid) /* TESTENOVO100 [contains] */,
  ('459083ce-c056-4aa1-a471-997983579e7f'::uuid) /* TESTE22_06_7 [contains] */,
  ('47e85cfb-ef99-49b2-9156-113e80a29361'::uuid) /* shoppingTeste02 [contains] */,
  ('490e9e73-d239-485f-b278-398c89457c6d'::uuid) /* ATestePS1 [contains] */,
  ('4f26559b-c1d2-455e-b2c2-31a797ad8b71'::uuid) /* TESTENOVO12_10_06 [contains] */,
  ('50ce950e-8b51-43ed-a2bf-4b5a5093a9d1'::uuid) /* TESTENOVO10_10_06 [contains] */,
  ('52d9f42f-d78f-4839-9dab-f515c2491454'::uuid) /* TestePreSetup1.1 [contains] */,
  ('5740c2d8-7a5f-4599-8083-29507da51359'::uuid) /* TesteSINC03 [contains] */,
  ('5e5f1ce1-b1e0-4781-98bc-84c526a1c1cc'::uuid) /* TESTENOVO_10_06 [contains] */,
  ('5f9b547f-792c-42bc-9c52-a43d1edf8a39'::uuid) /* TESTENOVO20_10_06 [contains] */,
  ('6002c5e5-7594-4bd2-8918-d4186d9a3465'::uuid) /* Testesinc22_06 [contains] */,
  ('63bed8c9-161e-44a4-9012-58b611d5de13'::uuid) /* TESTENOVO25_10_06 [contains] */,
  ('6f59747b-fc1c-482d-831a-0156d79211fe'::uuid) /* TESTENOVO16_10_06 [contains] */,
  ('701d1858-bf39-474b-a0cd-a278313a93bb'::uuid) /* TESTE24_10_06 [contains] */,
  ('749f3623-4f7f-4bff-8a6d-1a42360c6e66'::uuid) /* TESTE23_10_06 [contains] */,
  ('7aafaeb5-2d8a-4f16-9b52-0d58170ce581'::uuid) /* TESTE21_10_06 [contains] */,
  ('7eb5bd7c-ba4b-4b7d-a1db-9240ccba4347'::uuid) /* ATestePS04 [contains] */,
  ('7ef3d33c-8278-48f0-93a9-1710f8f5d0fa'::uuid) /* TESTE_15_06_2 [contains] */,
  ('8f45c96b-d638-4ab5-b844-b99915c1f090'::uuid) /* Teste522_06 [contains] */,
  ('97423021-a894-4261-a3e6-aaac27e2ed82'::uuid) /* Teste1_23_06 [contains] */,
  ('9832c11a-1b7d-4197-bcf5-ff3686e93a8d'::uuid) /* TESTENOVO4_10_06 [contains] */,
  ('9a4310b3-4b4e-4366-821a-3a12a0941e46'::uuid) /* TESTE15_06_4 [contains] */,
  ('9bf78acb-7927-4006-9c06-00b3cc865b38'::uuid) /* TESTENOVO17_10_06 [contains] */,
  ('9c2f8a48-804b-4ef6-8970-949b2011efc8'::uuid) /* TESTENOVO15_10_06 [contains] */,
  ('9e40c73c-9ff1-4f9a-9e2a-81fad4f18bd2'::uuid) /* ATestePS02 [contains] */,
  ('9ec36c51-fcdd-49dc-92da-110fc1299630'::uuid) /* Testegateway0222_06 [contains] */,
  ('a960519c-645a-4a42-a81f-b2cd7bbd337a'::uuid) /* ATestePS03 [contains] */,
  ('bbc55f96-0678-487f-ab0a-90f5c4b9cb90'::uuid) /* TESTENOVO18_10_06 [contains] */,
  ('bcec736e-3edc-4557-b752-bce6b9c16c9a'::uuid) /* TESTENOVO14_10_06 [contains] */,
  ('c471aab1-5838-49e1-8964-d7042cf76392'::uuid) /* TESTENOVO5_10_06 [contains] */,
  ('c522695e-75ba-4d67-b58f-48aaa02c9e20'::uuid) /* teste0806+4 [contains] */,
  ('cc5d8cab-5187-4035-92cd-cf888b2b5e49'::uuid) /* TESTENOVO3_10_06 [contains] */,
  ('e6a70e9d-7a34-4dca-8e12-9796bca45d10'::uuid) /* TESTE_NOVO2_10_06 [contains] */,
  ('f2ac51d3-2678-4712-b1ff-4143cd15082d'::uuid) /* TEStuidd2 [contains] */,
  ('f43e8ac8-d5a7-4b69-95f8-18a609f04496'::uuid) /* TESTENOVO6_10_06 [contains] */,
  ('f48d6c72-7c12-448e-a6d5-01baecdc9f9e'::uuid) /* ATestePS [contains] */,
  ('f5321975-c8a2-4469-8e1c-4c87731d900a'::uuid) /* TESTE_15_06 [contains] */,
  ('f58c2886-ae9e-4d9d-9035-9dc0a2b14fba'::uuid) /* TESTENOVO13_10_06 [contains] */,
  ('fb9b880f-4163-4ff0-9f30-7052e0fcafe8'::uuid) /* TESTE_15_06_1 [contains] */,
  ('6662b73d-49d3-4716-9001-66fb54651ddf'::uuid) /* SHOPPING 1 [dragged] */;

-- Sets derivados (materializados uma vez; a âncora não muda durante os deletes)
CREATE TEMP TABLE _assets ON COMMIT DROP AS
  SELECT id FROM assets WHERE customer_id IN (SELECT id FROM _alvo);

CREATE TEMP TABLE _centrals ON COMMIT DROP AS
  SELECT id FROM centrals
  WHERE customer_id IN (SELECT id FROM _alvo)
     OR asset_id    IN (SELECT id FROM _assets);

CREATE TEMP TABLE _devices ON COMMIT DROP AS
  SELECT id FROM devices
  WHERE customer_id IN (SELECT id FROM _alvo)
     OR asset_id    IN (SELECT id FROM _assets)
     OR central_id  IN (SELECT id FROM _centrals);

-- Conferência informativa (compare com o dry-run: 66 | ~300 | ~40 | >=470;
-- devices PODE ser maior que a soma do dry-run — é o objetivo: pega os
-- vinculados indiretamente)
DO $$
DECLARE c1 int; c2 int; c3 int; c4 int;
BEGIN
  SELECT count(*) INTO c1 FROM customers x JOIN _alvo a ON a.id = x.id;
  SELECT count(*) INTO c2 FROM _assets;
  SELECT count(*) INTO c3 FROM _centrals;
  SELECT count(*) INTO c4 FROM _devices;
  RAISE NOTICE 'escopo: % customers | % assets | % centrais | % devices', c1, c2, c3, c4;
END $$;

-- 1) Guarda: nenhum user pendurado nos alvos (dry-run dizia 0)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM users WHERE customer_id IN (SELECT id FROM _alvo);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORTADO: % user(s) em customers alvo — refaça a conferência', n;
  END IF;
END $$;

-- 2) Escopo de WOs de OUTROS customers apontando para devices derivados:
--    apenas DETACH da junção (não deletamos OS de cliente real).
DELETE FROM work_orders_devices
WHERE device_id IN (SELECT id FROM _devices)
  AND work_order_id NOT IN (
    SELECT id FROM work_orders WHERE customer_id IN (SELECT id FROM _alvo)
  );

-- 3) Work orders dos alvos (físico; eventos/escopo/arquivos por CASCADE)
DELETE FROM work_orders WHERE customer_id IN (SELECT id FROM _alvo);

-- 4) Filhos das centrais derivadas
DELETE FROM central_commands     WHERE central_id IN (SELECT id FROM _centrals);
DELETE FROM central_restore_jobs WHERE central_id IN (SELECT id FROM _centrals);
DELETE FROM central_backups      WHERE central_id IN (SELECT id FROM _centrals);

-- 5) Anotações derivadas: dos alvos, e as de QUALQUER customer sobre devices
--    derivados (filhos por CASCADE); menções por device (FK NO ACTION)
DELETE FROM annotations
WHERE customer_id IN (SELECT id FROM _alvo)
   OR (entity_type = 'device' AND entity_id IN (SELECT id FROM _devices));
DELETE FROM annotation_mentions
WHERE mentioned_device_id IN (SELECT id FROM _devices);

-- 6) Devices derivados (inclui os de customer_id inconsistente)
DELETE FROM devices WHERE id IN (SELECT id FROM _devices);

-- 7) Centrais derivadas e assets dos alvos
DELETE FROM centrals WHERE id IN (SELECT id FROM _centrals);
DELETE FROM assets   WHERE id IN (SELECT id FROM _assets);

-- 8) Satélites por customer
DELETE FROM groups                WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM look_and_feels        WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM customer_api_keys     WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM maintenance_groups    WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM file_assets           WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM alarm_bundle_versions WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM rules                 WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM entities              WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM simulator_sessions    WHERE customer_id IN (SELECT id FROM _alvo);
DELETE FROM audit_logs            WHERE customer_id IN (SELECT id FROM _alvo);

-- 9) Customers (cascades: templates, customer_channels, consumption_goals,
--    work_orders_customer_settings)
DELETE FROM customers WHERE id IN (SELECT id FROM _alvo);

-- Pós-verificação: nada derivado pode ter sobrado
DO $$
DECLARE n1 int; n2 int; n3 int; n4 int;
BEGIN
  SELECT count(*) INTO n1 FROM customers WHERE id IN (SELECT id FROM _alvo);
  SELECT count(*) INTO n2 FROM assets    WHERE id IN (SELECT id FROM _assets);
  SELECT count(*) INTO n3 FROM centrals  WHERE id IN (SELECT id FROM _centrals);
  SELECT count(*) INTO n4 FROM devices   WHERE id IN (SELECT id FROM _devices);
  IF n1 + n2 + n3 + n4 > 0 THEN
    RAISE EXCEPTION 'ABORTADO: sobraram % customers, % assets, % centrais, % devices', n1, n2, n3, n4;
  END IF;
  RAISE NOTICE 'limpeza concluída: 0 derivados restantes';
END $$;

COMMIT;
