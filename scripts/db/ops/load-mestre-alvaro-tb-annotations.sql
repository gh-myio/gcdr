-- =============================================================================
-- RFC-0036 backfill: ThingsBoard log_annotations -> GCDR annotations
-- Customer: Mestre Alvaro (SMA) - Sa Cavalcante
-- Source: TB export _SELECT_d_id_..._202607091325.csv (111 devices)
-- Generated: 2026-07-09
--
-- IDEMPOTENT: annotations and annotation_responses carry legacy_id (the TB
-- uuid) and land with ON CONFLICT DO NOTHING on the partial unique index
-- (tenant_id, legacy_id). annotation_events (the history[] mirror) have no
-- legacy_id; they are inserted ONLY when the parent annotation insert actually
-- happened (CTE gating), so a re-run adds nothing.
--
-- tenant_id / customer_id are derived from the target device row, never
-- hardcoded. A device id missing from `devices` simply no-ops (and shows up in
-- the pre-check below).
-- =============================================================================

-- Pre-check: CSV devices missing from the registry (each line here will no-op)
SELECT x.gcdr_device_id AS missing_device
FROM (VALUES
  ('a8c5c842-b9e9-4a2a-95c1-27da217460e9'::uuid),  ('2b526f1f-cab8-445b-a27a-15f8054e8424'::uuid),  ('cc4a6665-4630-4c7d-a309-3f9a4a78f351'::uuid),  ('9a7342dc-83c0-41ad-98b2-2f7c9ffd46f9'::uuid),  ('b4e6cf1b-5420-44a6-a75d-ecd7cb7982dd'::uuid),  ('e0b18d2c-6418-4c00-adba-41564b82960b'::uuid),  ('5e7f1446-89c2-42d1-8059-f72bd405e8a7'::uuid),  ('b56d38c1-ee73-4697-8bd2-5be00e21c655'::uuid),  ('3364033a-d818-4f4a-89ad-2a11b6bd2fcd'::uuid),  ('c18e842a-4b6b-48cb-9254-a7b9c26e54fc'::uuid),  ('4842ed4d-bfa9-4f04-ab6b-118af951395e'::uuid),  ('348715e0-89c3-456d-8fe9-a009cb45a848'::uuid),  ('96326fb4-52bd-4816-8986-e08806e50b8e'::uuid),  ('d1cc7168-0d03-4e09-b714-2dfc9b8a3531'::uuid),  ('f56e9d67-211d-40b8-b3e8-3fddf5c606d0'::uuid),  ('881b4e22-73ca-471b-b1a9-645a68956489'::uuid),  ('67c3ed84-9487-4907-945d-90a008557e64'::uuid),  ('291a93c9-1f4f-4b13-8394-afe5620847a9'::uuid),  ('c28d989a-95a4-4f2b-bea2-4212e82f8e74'::uuid),  ('a8c572a5-053d-4856-af9c-ef340afebbfa'::uuid),  ('d54ebfad-1966-49ff-a0b7-3ababb1f894f'::uuid),  ('5a075f17-f38d-4765-89ae-37a6a4f6eebc'::uuid),  ('344dc16b-92c2-4901-94db-e4fd2a507bdd'::uuid),  ('22c97f23-5e26-4bf3-95ac-90bbcb024946'::uuid),  ('20913d19-06b1-4d32-aa99-07c28bd71e2c'::uuid),  ('8afe1fed-1744-470b-bb34-a459835cf2d9'::uuid),  ('d36d4003-e0b9-4f52-80a5-790758eea328'::uuid),  ('e70e1ccc-3674-411e-b9b7-b1dd2b89746f'::uuid),  ('1e13c904-30a3-403a-9345-9a697674a829'::uuid),  ('30805708-b5c7-442b-b4c1-d84c4dbb0c68'::uuid),  ('0fa47de9-b75b-4572-baea-cc5a452c59f7'::uuid),  ('d689a53f-44f0-43b3-9126-307321de5b31'::uuid),  ('7e3e6572-3fe0-470d-8b20-87a7da186274'::uuid),  ('e84a161a-acbb-4c7c-af8d-274b904fd1a3'::uuid),  ('36860c96-b2dd-4bb6-858c-f76cc89ce432'::uuid),  ('f6393f95-ddf0-4af3-8b6e-e8414beb7b1d'::uuid),  ('dcd383f2-566e-4c0a-9e97-7a3b01f00756'::uuid),  ('d5327d13-9879-4415-b802-7d094ce80d1e'::uuid),  ('d7f081e9-9447-4afd-919a-19d36bae0d1c'::uuid),  ('86c26bd5-3e3c-46c1-aa80-780b6aaf786c'::uuid),  ('a6858835-1433-4b83-8277-8ab48d6c1f1c'::uuid),  ('f5ba60d1-0eba-42bc-a5d0-36305baa5764'::uuid),  ('1f01672c-8f71-4bf9-989c-7ab98220ad12'::uuid),  ('12f660cd-957f-4e6a-b7d6-006de541739c'::uuid),  ('d15d87ea-ba3c-4c52-aca5-fff3065eec3f'::uuid),  ('33af1b5c-f771-46ce-aa30-b7324b04f26b'::uuid),  ('ee533328-c0a6-4439-8154-df146a80ab98'::uuid),  ('51792575-7c2e-4a3a-922f-2f6454e3fc24'::uuid),  ('11fa9356-1063-41ea-970a-b7eee85e21df'::uuid),  ('a98cac94-168c-4bda-a329-eabbae2e909f'::uuid),  ('945638fd-57a7-4164-88b7-8cc95046933e'::uuid),  ('c8dec94d-e1b2-499e-a5f8-873bd595838f'::uuid),  ('97e10ac2-d6a1-456f-a930-19504be376ca'::uuid),  ('58e94534-e997-4a74-b64f-7d08ee07a744'::uuid),  ('8c945215-3483-4ee0-962a-d8ae4e97296a'::uuid),  ('452b452c-c872-4a88-9d71-1bee17e7b6d2'::uuid),  ('40b42b05-1094-4b56-ab34-4312e83c8f0d'::uuid),  ('b6ef42ca-8b39-4cc1-87f2-d5299c27cff8'::uuid),  ('a4446b6d-d6b8-4aa1-801f-83a1f2bb6999'::uuid),  ('b6bd1f85-85a6-427b-9cc9-43ac5a1a48ea'::uuid),  ('d615b0a1-8a2b-4cc4-85b2-2fcca7a8656c'::uuid),  ('a2196e14-ef3c-4c39-8e88-ccec1e79a47c'::uuid),  ('c85451d9-c36b-4d8a-abe4-761293dd3d80'::uuid),  ('0ab1a774-97ec-4766-989a-66f5a47104d1'::uuid),  ('855447be-0c73-4370-bf48-e2f9f2b9887c'::uuid),  ('e0b1915b-ac3e-4a8f-ac2c-398cdd05d810'::uuid),  ('8f47e2f0-fcd3-4c2d-9d63-1e681581609f'::uuid),  ('3cf9d20c-fc8a-4fbb-88f4-3bb07a7a6c06'::uuid),  ('efb65380-8f66-4dda-915a-a47a6b875085'::uuid),  ('3a8966c5-64ce-4164-98cd-a1ee07944d73'::uuid),  ('2a8ccea4-5891-455e-a690-622eae78c2be'::uuid),  ('0d6fca87-ffc4-4ecd-a1cf-9227748d0263'::uuid),  ('957825ad-0083-4ae3-8fc8-a36ed5b035bc'::uuid),  ('739ecf16-bc31-41b6-972d-5fed81be0a1d'::uuid),  ('1b2ebebd-97a0-4228-af61-55bbc0472d8b'::uuid),  ('02e580c9-df28-4d0b-b156-c6fdb359d453'::uuid),  ('59600fd2-c57c-4d9d-824e-cd0521c00260'::uuid),  ('798db98d-a16a-4fd3-a249-dbecb6087c51'::uuid),  ('b389aa3f-8896-4209-9e85-ae0640f5fa55'::uuid),  ('3c7fd801-da25-4b3c-888d-ff92a03c9b68'::uuid),  ('74a193b0-9031-4d5b-a2e5-91ceda1a664a'::uuid),  ('8604db12-c22f-41e6-8c34-82f86038217d'::uuid),  ('a3296240-a933-43b1-9ebf-5f7ba5b47028'::uuid),  ('e0bc3fb7-dfd2-4f69-b6e6-9e8d6bb30273'::uuid),  ('b8abdd64-2690-48f4-86d7-e96aa2e5af66'::uuid),  ('c90e0163-8833-4315-80bf-48bd77aefee6'::uuid),  ('e46e0faf-3aed-4536-87f3-480d9eef4cd0'::uuid),  ('8ae6f555-00ce-41de-9991-e1338b78395c'::uuid),  ('72ecb033-51d9-4ec7-9592-097ff4ae1a0a'::uuid),  ('4b5e21ad-30fc-48f1-95c1-a98dfcb107ac'::uuid),  ('91e5510a-9730-43a5-b8c5-0e22caaa7053'::uuid),  ('218a1641-4c37-4abe-8234-5320af8fffdf'::uuid),  ('b5e05c54-e890-46d2-b361-e6b21382bd78'::uuid),  ('d43d3361-5171-4ec9-97cb-dc4f1a40089e'::uuid),  ('bc4cdc3b-2a5a-4b06-95f7-d37bd6748c1d'::uuid),  ('6526b1c9-5cce-4e70-bc47-66c624e8d74c'::uuid),  ('fe8d3c5e-4d34-4812-9b06-26bda1158d97'::uuid),  ('ba8f743b-0dc3-41fb-ad14-80a24a324bd6'::uuid),  ('d5b76b97-0ecc-4a0c-bd7d-dcc9e1245f4a'::uuid),  ('4f2abda0-e9ca-47c7-b7ca-58bfbefa597e'::uuid),  ('7218df55-5cde-4cb6-a476-27211c6e1bf0'::uuid),  ('6aa29dcb-a932-4a99-ab03-6fdafb154488'::uuid),  ('5b8ed194-3c42-4b3f-b782-f54e74b83996'::uuid),  ('95ef4bba-6327-48bf-93df-2454f2a9023e'::uuid),  ('6255116e-3c74-40a6-8f86-e69ffdc9e5cd'::uuid),  ('07fe84db-75fe-440a-ac15-3a200678c61a'::uuid),  ('7b8a732e-5750-4062-98c6-64dd128afc68'::uuid),  ('dac44277-ecc7-45f9-824f-4a44dc68627c'::uuid),  ('e543219d-c7a7-409d-a670-b5e764a21b61'::uuid),  ('9451a8c8-0d9b-48de-b9df-67079ffa3a6b'::uuid),  ('9eb75b77-c9b8-4ff6-9acb-952f43321e4c'::uuid)
) AS x(gcdr_device_id)
LEFT JOIN devices d ON d.id = x.gcdr_device_id
WHERE d.id IS NULL;

BEGIN;


-- ── 3F 104ABCJKL (São Jose Super) — device a8c5c842-b9e9-4a2a-95c1-27da217460e9 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a8c5c842-b9e9-4a2a-95c1-27da217460e9'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Realocar sensor  para GUVEL 302I)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:14:21.039Z'::timestamptz, '2026-04-03T15:39:14.177Z'::timestamptz, 2, 'dae14df0-6f3a-4340-996e-5714ac64b6d9'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:14:21.039Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:39:14.177Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:39:14.177Z'::timestamptz, '71ddedf0-6543-487a-94b1-5dfe25f84b03'::uuid
FROM annotations a
WHERE a.legacy_id = 'dae14df0-6f3a-4340-996e-5714ac64b6d9'::uuid AND a.entity_id = 'a8c5c842-b9e9-4a2a-95c1-27da217460e9'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F ELEV. SCMAL2ACEL2 (Elevador 2) — device 2b526f1f-cab8-445b-a27a-15f8054e8424 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '2b526f1f-cab8-445b-a27a-15f8054e8424'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'elevador 14', 'observation', 3, 'created', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T19:23:58.933Z'::timestamptz, '2026-03-04T19:23:58.933Z'::timestamptz, 1, '04068c28-38f5-4438-b8dc-6c5f4591ce19'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T19:23:58.933Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F ESRL. PF-Escada 05 (ER 5) — device cc4a6665-4630-4c7d-a309-3f9a4a78f351 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'cc4a6665-4630-4c7d-a309-3f9a4a78f351'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Escada parada para manutenção.', 'observation', 3, 'created', false, NULL, NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-05-26T19:41:49.900Z'::timestamptz, '2026-05-26T19:41:49.900Z'::timestamptz, 1, '8189d5ca-5d25-4668-b1e9-d7e3929fb1cb'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-05-26T19:41:49.900Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'cc4a6665-4630-4c7d-a309-3f9a4a78f351'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Confirmar Identificação no disjuntor', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:19:02.475Z'::timestamptz, '2026-04-03T15:10:38.432Z'::timestamptz, 2, '72612cbd-3c1b-4914-8182-2ccf156c51f6'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:19:02.475Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:10:38.432Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:10:38.432Z'::timestamptz, 'a25a8845-5ee6-4b0a-a872-de7b596a33bc'::uuid
FROM annotations a
WHERE a.legacy_id = '72612cbd-3c1b-4914-8182-2ccf156c51f6'::uuid AND a.entity_id = 'cc4a6665-4630-4c7d-a309-3f9a4a78f351'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F ESRL. PF-Escada 16 (ER 16) — device 9a7342dc-83c0-41ad-98b2-2f7c9ffd46f9 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '9a7342dc-83c0-41ad-98b2-2f7c9ffd46f9'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Escada em manutenção, aguardando chegada do degrau e da polia', 'observation', 3, 'created', false, NULL, NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-07-08T20:49:57.034Z'::timestamptz, '2026-07-08T20:49:57.034Z'::timestamptz, 1, '940fc173-dea9-4606-b19d-f4ef2a7e1237'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-07-08T20:49:57.034Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '9a7342dc-83c0-41ad-98b2-2f7c9ffd46f9'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'encaminhado para o desenvolvimento', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:19:58.350Z'::timestamptz, '2026-04-03T15:13:14.923Z'::timestamptz, 2, 'ec6bdc7f-335b-48e5-a8bf-c6e28337711e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:19:58.350Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:13:14.923Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:13:14.923Z'::timestamptz, '1e1a8566-a04e-4d1f-a5c7-85b4a6b1e26d'::uuid
FROM annotations a
WHERE a.legacy_id = 'ec6bdc7f-335b-48e5-a8bf-c6e28337711e'::uuid AND a.entity_id = '9a7342dc-83c0-41ad-98b2-2f7c9ffd46f9'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F MOTR. SCMAL2ACAC-Fancoil 9 (Fancoil 9) — device b4e6cf1b-5420-44a6-a75d-ecd7cb7982dd ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b4e6cf1b-5420-44a6-a75d-ecd7cb7982dd'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Motor recolocado', 'activity', 3, 'created', false, NULL, NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-03-11T19:15:34.569Z'::timestamptz, '2026-03-11T19:15:34.569Z'::timestamptz, 1, 'd70765b8-f33f-4881-a057-9d781a94f643'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-03-11T19:15:34.569Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b4e6cf1b-5420-44a6-a75d-ecd7cb7982dd'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Está desativado e o motor foi realocado para o Fancoil 20', 'maintenance', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T17:32:12.261Z'::timestamptz, '2026-04-03T15:11:00.410Z'::timestamptz, 2, '0b9c8706-212a-445d-ad99-52adcede9548'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T17:32:12.261Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:11:00.410Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:11:00.410Z'::timestamptz, 'bd391503-a263-44c8-8178-d4ce28081618'::uuid
FROM annotations a
WHERE a.legacy_id = '0b9c8706-212a-445d-ad99-52adcede9548'::uuid AND a.entity_id = 'b4e6cf1b-5420-44a6-a75d-ecd7cb7982dd'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F MOTR. SCMAL2ACAC-Fancoil26 (Fancoil 26) — device e0b18d2c-6418-4c00-adba-41564b82960b ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e0b18d2c-6418-4c00-adba-41564b82960b'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Time tecnico Myio identificou ponto como Fancoil26. Anteriormente Fancoil2', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-07-07T19:41:20.328Z'::timestamptz, '2026-07-07T19:41:31.428Z'::timestamptz, 2, 'c657c39d-0604-49af-9cf8-51c79904d095'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-07-07T19:41:20.328Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-07-07T19:41:31.428Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'realizada alteração', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-07-07T19:41:31.428Z'::timestamptz, 'a168a8a8-79d8-46cd-b55a-46f61eeb5d1c'::uuid
FROM annotations a
WHERE a.legacy_id = 'c657c39d-0604-49af-9cf8-51c79904d095'::uuid AND a.entity_id = 'e0b18d2c-6418-4c00-adba-41564b82960b'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F MOTR. SCMAL2ACCAGBAG-C 01 (Bomba Condensada 1) — device 5e7f1446-89c2-42d1-8059-f72bd405e8a7 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '5e7f1446-89c2-42d1-8059-f72bd405e8a7'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Bomba de água condensada 1 enviada à oficina para reparo no selo mecânico', 'observation', 4, 'created', false, NULL, NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-07-08T20:48:48.391Z'::timestamptz, '2026-07-08T20:48:48.391Z'::timestamptz, 1, 'b123d15b-4f8b-4f9e-a7d6-2d5025f84b56'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-07-08T20:48:48.391Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F SCMAL0L102A (Faculdade Mandic) — device b56d38c1-ee73-4697-8bd2-5be00e21c655 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b56d38c1-ee73-4697-8bd2-5be00e21c655'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Medidor em algumas horas dos dias não está registrando o consumo', 'pending', 3, 'created', false, NULL, NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-07T15:18:54.955Z'::timestamptz, '2026-04-07T15:18:54.955Z'::timestamptz, 1, 'b1e65683-9c05-4fdd-8e4a-61382f1f8145'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-07T15:18:54.955Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b56d38c1-ee73-4697-8bd2-5be00e21c655'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Medidor em algumas horas dos dias não está registrando o consumo', 'pending', 3, 'created', true, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-07T15:17:39.745Z'::timestamptz, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-07T15:16:49.848Z'::timestamptz, '2026-04-07T15:17:39.745Z'::timestamptz, 2, '55bb1c46-f61a-4a9f-9728-45f8250e1a71'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-07T15:16:49.848Z'::timestamptz),  ('rejected', 1, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-07T15:17:39.745Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'rejected', 'Já resolvido', '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-07T15:17:39.745Z'::timestamptz, '3b2460e9-156e-46e7-abcd-1b570bbb5dcd'::uuid
FROM annotations a
WHERE a.legacy_id = '55bb1c46-f61a-4a9f-9728-45f8250e1a71'::uuid AND a.entity_id = 'b56d38c1-ee73-4697-8bd2-5be00e21c655'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L103C (DEPÓSITO DIVINO FOGÃO) — device 3364033a-d818-4f4a-89ad-2a11b6bd2fcd ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '3364033a-d818-4f4a-89ad-2a11b6bd2fcd'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Realizar ajuste no painel', 'activity', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T13:19:24.450Z'::timestamptz, '2026-04-03T15:15:38.754Z'::timestamptz, 2, '61a62f09-e12b-40ef-8f66-3d724f822227'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T13:19:24.450Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:15:38.754Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:15:38.754Z'::timestamptz, 'de6cec67-5c39-46fe-b64a-9f671c61d001'::uuid
FROM annotations a
WHERE a.legacy_id = '61a62f09-e12b-40ef-8f66-3d724f822227'::uuid AND a.entity_id = '3364033a-d818-4f4a-89ad-2a11b6bd2fcd'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '3364033a-d818-4f4a-89ad-2a11b6bd2fcd'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(REALOCAR P/ FLORENZZA 210D)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:13:18.320Z'::timestamptz, '2026-04-03T15:15:51.605Z'::timestamptz, 3, '0e73bdfd-69f7-421d-876d-6f775eea4611'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:13:18.320Z'::timestamptz),  ('modified', 1, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:19:30.234Z'::timestamptz),  ('archived', 2, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:15:51.605Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:15:51.605Z'::timestamptz, 'e1cef11b-cf77-4de0-a083-09e91ff0e604'::uuid
FROM annotations a
WHERE a.legacy_id = '0e73bdfd-69f7-421d-876d-6f775eea4611'::uuid AND a.entity_id = '3364033a-d818-4f4a-89ad-2a11b6bd2fcd'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1102C (MC DONALD´S) — device c18e842a-4b6b-48cb-9254-a7b9c26e54fc ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'c18e842a-4b6b-48cb-9254-a7b9c26e54fc'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Teste anotação apres', 'observation', 2, 'created', true, '{"id": "e9b7e0f0-e84a-11ee-8327-cfc6eea1d65a", "email": "jp@myio.com.br", "name": "João Paulo"}'::jsonb, '2026-05-28T13:20:46.151Z'::timestamptz, '{"id": "e9b7e0f0-e84a-11ee-8327-cfc6eea1d65a", "email": "jp@myio.com.br", "name": "João Paulo"}'::jsonb, '2026-05-28T13:19:03.416Z'::timestamptz, '2026-05-28T13:20:46.151Z'::timestamptz, 2, '757c3a5f-c70c-456f-983a-8da02685708e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e9b7e0f0-e84a-11ee-8327-cfc6eea1d65a", "email": "jp@myio.com.br", "name": "João Paulo"}'::jsonb, '2026-05-28T13:19:03.416Z'::timestamptz),  ('rejected', 1, '{"id": "e9b7e0f0-e84a-11ee-8327-cfc6eea1d65a", "email": "jp@myio.com.br", "name": "João Paulo"}'::jsonb, '2026-05-28T13:20:46.151Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'rejected', 'Teste Sw', '{"id": "e9b7e0f0-e84a-11ee-8327-cfc6eea1d65a", "email": "jp@myio.com.br", "name": "João Paulo"}'::jsonb, '2026-05-28T13:20:46.151Z'::timestamptz, '36e79cb6-829d-4ed7-9bff-c0e9dea5af66'::uuid
FROM annotations a
WHERE a.legacy_id = '757c3a5f-c70c-456f-983a-8da02685708e'::uuid AND a.entity_id = 'c18e842a-4b6b-48cb-9254-a7b9c26e54fc'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1103A (LAVATERIA) — device 4842ed4d-bfa9-4f04-ab6b-118af951395e ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '4842ed4d-bfa9-4f04-ab6b-118af951395e'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Está com consumo, falta definir a LOJA / ETIQUETA para o LUC 103A', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "37e6b1e0-1fb6-11f0-9baa-8137e6ac9d72", "email": "rodrigo@myio.com.br", "name": "Rodrigo Lago"}'::jsonb, '2026-01-09T15:45:23.333Z'::timestamptz, '2026-04-03T15:14:33.072Z'::timestamptz, 2, 'cbcfb541-c5a0-4a4e-be89-77bf9fd8eb8c'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "37e6b1e0-1fb6-11f0-9baa-8137e6ac9d72", "email": "rodrigo@myio.com.br", "name": "Rodrigo Lago"}'::jsonb, '2026-01-09T15:45:23.333Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:14:33.072Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'alterado', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:14:33.072Z'::timestamptz, '30caf52e-4266-4c0b-b67d-a47f60b22ba5'::uuid
FROM annotations a
WHERE a.legacy_id = 'cbcfb541-c5a0-4a4e-be89-77bf9fd8eb8c'::uuid AND a.entity_id = '4842ed4d-bfa9-4f04-ab6b-118af951395e'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1103H (PHONE PRIME) — device 348715e0-89c3-456d-8fe9-a009cb45a848 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '348715e0-89c3-456d-8fe9-a009cb45a848'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '103H pertence ao correio, loja ao lado esta fechado.', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T18:42:53.976Z'::timestamptz, '2026-04-03T15:33:52.815Z'::timestamptz, 2, '204720b6-fe7c-479f-82dc-bc1639410fee'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T18:42:53.976Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:33:52.815Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'alterado', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:33:52.815Z'::timestamptz, 'a64c6860-85f9-4bcd-8881-d7fbe0fa69f4'::uuid
FROM annotations a
WHERE a.legacy_id = '204720b6-fe7c-479f-82dc-bc1639410fee'::uuid AND a.entity_id = '348715e0-89c3-456d-8fe9-a009cb45a848'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1107C (CHIQUINHO SORVETES) — device 96326fb4-52bd-4816-8986-e08806e50b8e ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '96326fb4-52bd-4816-8986-e08806e50b8e'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'realocado', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-10T03:24:38.554Z'::timestamptz, '2026-04-03T15:35:00.700Z'::timestamptz, 2, '32276ebf-a04c-410d-8147-fa1c593cedcb'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-10T03:24:38.554Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:35:00.700Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:35:00.700Z'::timestamptz, '7d116354-06af-4148-81f7-a198fe594092'::uuid
FROM annotations a
WHERE a.legacy_id = '32276ebf-a04c-410d-8147-fa1c593cedcb'::uuid AND a.entity_id = '96326fb4-52bd-4816-8986-e08806e50b8e'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1107E (Divino Fogão) — device d1cc7168-0d03-4e09-b714-2dfc9b8a3531 ── 3 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd1cc7168-0d03-4e09-b714-2dfc9b8a3531'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja está ativa, informado pelo colaborador Alessandro', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T17:35:16.008Z'::timestamptz, '2026-02-03T12:51:11.552Z'::timestamptz, 2, 'bc13cb72-c143-4f5b-a8e3-3c0832c84c83'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T17:35:16.008Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:51:11.552Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'Sensor Instalado e funcionando', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:51:11.552Z'::timestamptz, '8adf0935-ea00-40e0-9ee9-ecea3c894ab6'::uuid
FROM annotations a
WHERE a.legacy_id = 'bc13cb72-c143-4f5b-a8e3-3c0832c84c83'::uuid AND a.entity_id = 'd1cc7168-0d03-4e09-b714-2dfc9b8a3531'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd1cc7168-0d03-4e09-b714-2dfc9b8a3531'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja está ativa, informado pelo colaborador Alessandro', 'pending', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T17:21:04.397Z'::timestamptz, '2026-01-07T17:34:55.993Z'::timestamptz, 2, 'a90be693-39df-4269-b198-89a7b5ab29f4'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T17:21:04.397Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T17:34:55.993Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd1cc7168-0d03-4e09-b714-2dfc9b8a3531'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja em obra quadro de energia retirado', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T13:22:11.130Z'::timestamptz, '2026-02-03T12:51:22.619Z'::timestamptz, 2, '12a68a75-fb69-4ed1-9c53-bd381dbdf5d4'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T13:22:11.130Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:51:22.619Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'Sensor instalado e funcionando', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:51:22.619Z'::timestamptz, '21a8066d-06d6-455f-a976-4adbbf1a0863'::uuid
FROM annotations a
WHERE a.legacy_id = '12a68a75-fb69-4ed1-9c53-bd381dbdf5d4'::uuid AND a.entity_id = 'd1cc7168-0d03-4e09-b714-2dfc9b8a3531'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1110E (PARAÍSO MAKEUP) — device f56e9d67-211d-40b8-b3e8-3fddf5c606d0 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'f56e9d67-211d-40b8-b3e8-3fddf5c606d0'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '"Loja fechada e medidor 3F instalado! 
Era paraíso Makup"', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T18:43:54.463Z'::timestamptz, '2026-04-03T15:16:05.565Z'::timestamptz, 2, 'e53cbad6-211c-47ff-91b1-4372888b63bb'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T18:43:54.463Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:16:05.565Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:16:05.565Z'::timestamptz, '2322f3a6-4d9c-4b38-a016-d3463579554b'::uuid
FROM annotations a
WHERE a.legacy_id = 'e53cbad6-211c-47ff-91b1-4372888b63bb'::uuid AND a.entity_id = 'f56e9d67-211d-40b8-b3e8-3fddf5c606d0'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1112A (PRAÇA PET) — device 881b4e22-73ca-471b-b1a9-645a68956489 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '881b4e22-73ca-471b-b1a9-645a68956489'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Realocar sensor para ITAPUÃ 308ABCDE)', 'observation', 3, 'created', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:20:46.741Z'::timestamptz, '2026-01-08T13:20:46.741Z'::timestamptz, 1, 'c7fa5f85-bc5c-400a-ae05-7ef6afa0b1eb'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:20:46.741Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F SCMAL0L1112FG (Era FRAGRANCE agora está indicado para De Martim (não instalado)) — device 67c3ed84-9487-4907-945d-90a008557e64 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '67c3ed84-9487-4907-945d-90a008557e64'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Alterado 112FG_DE MARTIN para 306FG FRAGRANCE realocação.', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T19:41:55.795Z'::timestamptz, '2026-02-03T19:42:14.606Z'::timestamptz, 2, '79d6acfb-fab2-406f-b0a6-62f17dcbd29e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T19:41:55.795Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T19:42:14.606Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'alteração realizada', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T19:42:14.606Z'::timestamptz, '2e5ad5d8-cd87-4c3f-9c27-9050ac60b791'::uuid
FROM annotations a
WHERE a.legacy_id = '79d6acfb-fab2-406f-b0a6-62f17dcbd29e'::uuid AND a.entity_id = '67c3ed84-9487-4907-945d-90a008557e64'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '67c3ed84-9487-4907-945d-90a008557e64'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Realocar sensor  para FRAGRANCE 306FG)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:18:53.740Z'::timestamptz, '2026-02-03T19:40:45.860Z'::timestamptz, 3, 'dd1229a6-68b6-4071-9b26-595061227508'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:18:53.740Z'::timestamptz),  ('commented', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T19:40:23.618Z'::timestamptz),  ('archived', 2, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T19:40:45.860Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'comment', 'Realocação realizada', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T19:40:23.618Z'::timestamptz, '732c1a19-bd3d-4298-98b5-2468e744380c'::uuid
FROM annotations a
WHERE a.legacy_id = 'dd1229a6-68b6-4071-9b26-595061227508'::uuid AND a.entity_id = '67c3ed84-9487-4907-945d-90a008557e64'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'Realocação realizada', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T19:40:45.860Z'::timestamptz, 'c851f53f-d69b-45f7-bcaf-fe7949d529f1'::uuid
FROM annotations a
WHERE a.legacy_id = 'dd1229a6-68b6-4071-9b26-595061227508'::uuid AND a.entity_id = '67c3ed84-9487-4907-945d-90a008557e64'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1112H (Paraíso Makeup) — device 291a93c9-1f4f-4b13-8394-afe5620847a9 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '291a93c9-1f4f-4b13-8394-afe5620847a9'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja fechada', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:22:50.814Z'::timestamptz, '2026-04-03T15:38:28.938Z'::timestamptz, 2, '9a8bf99f-e8d9-43a9-bb81-d372ff31d3b4'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:22:50.814Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:38:28.938Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:38:28.938Z'::timestamptz, 'd47a140b-3a0d-45e0-b214-1d75d9f5b755'::uuid
FROM annotations a
WHERE a.legacy_id = '9a8bf99f-e8d9-43a9-bb81-d372ff31d3b4'::uuid AND a.entity_id = '291a93c9-1f4f-4b13-8394-afe5620847a9'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1114A (KFC) — device c28d989a-95a4-4f2b-bea2-4212e82f8e74 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'c28d989a-95a4-4f2b-bea2-4212e82f8e74'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja fechada', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T19:34:15.902Z'::timestamptz, '2026-04-03T15:40:29.517Z'::timestamptz, 2, '26950610-c4eb-46d4-bea5-e9b2da8e4fda'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T19:34:15.902Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:40:29.517Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:40:29.517Z'::timestamptz, '165cfa74-2373-450f-97cd-90ea65938cf5'::uuid
FROM annotations a
WHERE a.legacy_id = '26950610-c4eb-46d4-bea5-e9b2da8e4fda'::uuid AND a.entity_id = 'c28d989a-95a4-4f2b-bea2-4212e82f8e74'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1115A_2 (Don Burguer) — device a8c572a5-053d-4856-af9c-ef340afebbfa ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a8c572a5-053d-4856-af9c-ef340afebbfa'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Alterado LUC 115A para 105B', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:44:46.272Z'::timestamptz, '2026-04-03T15:45:00.054Z'::timestamptz, 2, 'b098a74b-04de-4f89-981d-c7b5cb38306c'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:44:46.272Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:45:00.054Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'realizado', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:45:00.054Z'::timestamptz, '7f70c4d5-e458-4e98-85e5-fb063ad32466'::uuid
FROM annotations a
WHERE a.legacy_id = 'b098a74b-04de-4f89-981d-c7b5cb38306c'::uuid AND a.entity_id = 'a8c572a5-053d-4856-af9c-ef340afebbfa'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a8c572a5-053d-4856-af9c-ef340afebbfa'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'DON burguer LUC ATUAL 105B', 'pending', 3, 'archived', false, NULL, NULL, '{"id": "07d89480-e7e7-11ee-8327-cfc6eea1d65a", "email": "bruno@myio.com.br", "name": "Bruno Dantas"}'::jsonb, '2026-03-01T15:26:25.500Z'::timestamptz, '2026-04-03T15:44:53.362Z'::timestamptz, 2, 'da0d9b00-be8b-46fb-b25c-8b33a3feb23c'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "07d89480-e7e7-11ee-8327-cfc6eea1d65a", "email": "bruno@myio.com.br", "name": "Bruno Dantas"}'::jsonb, '2026-03-01T15:26:25.500Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:44:53.362Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'realizado', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:44:53.362Z'::timestamptz, 'f069b08e-3080-45d2-a37e-a99615b087d2'::uuid
FROM annotations a
WHERE a.legacy_id = 'da0d9b00-be8b-46fb-b25c-8b33a3feb23c'::uuid AND a.entity_id = 'a8c572a5-053d-4856-af9c-ef340afebbfa'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1Q104 (MD SUCESSO) — device d54ebfad-1966-49ff-a0b7-3ababb1f894f ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd54ebfad-1966-49ff-a0b7-3ababb1f894f'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Loja Fechada)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:54:51.747Z'::timestamptz, '2026-04-03T15:37:45.817Z'::timestamptz, 2, 'e973a3df-1385-41a8-b68e-886ca1c22caf'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:54:51.747Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:37:45.817Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:37:45.817Z'::timestamptz, '64ea5eae-018a-42b9-9248-f140876abcbc'::uuid
FROM annotations a
WHERE a.legacy_id = 'e973a3df-1385-41a8-b68e-886ca1c22caf'::uuid AND a.entity_id = 'd54ebfad-1966-49ff-a0b7-3ababb1f894f'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1Q107 (MUNDO DE CHOCOLATE) — device 5a075f17-f38d-4765-89ae-37a6a4f6eebc ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '5a075f17-f38d-4765-89ae-37a6a4f6eebc'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(LOJA FECHADA)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:54:09.405Z'::timestamptz, '2026-04-03T15:38:17.563Z'::timestamptz, 2, '5b229afe-6c7e-4faf-93a5-0d1b328f4ecf'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:54:09.405Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:38:17.563Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:38:17.563Z'::timestamptz, '89b397f7-dadf-4f04-9852-7e5bd40571c1'::uuid
FROM annotations a
WHERE a.legacy_id = '5b229afe-6c7e-4faf-93a5-0d1b328f4ecf'::uuid AND a.entity_id = '5a075f17-f38d-4765-89ae-37a6a4f6eebc'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1Q108 (FRED DOG) — device 344dc16b-92c2-4901-94db-e4fd2a507bdd ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '344dc16b-92c2-4901-94db-e4fd2a507bdd'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '( shopping não localizou o ponto de energia)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:24:25.956Z'::timestamptz, '2026-04-03T15:31:56.484Z'::timestamptz, 2, '4bc2939b-d36f-4cef-bd04-ea6b392903f2'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:24:25.956Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:31:56.484Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:31:56.484Z'::timestamptz, '3c57d06e-9f0c-47f7-9d99-6b23798b8c9f'::uuid
FROM annotations a
WHERE a.legacy_id = '4bc2939b-d36f-4cef-bd04-ea6b392903f2'::uuid AND a.entity_id = '344dc16b-92c2-4901-94db-e4fd2a507bdd'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL0L1Q110F (PRIZE STATION) — device 22c97f23-5e26-4bf3-95ac-90bbcb024946 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '22c97f23-5e26-4bf3-95ac-90bbcb024946'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Não Instalado Inexistente)', 'observation', 3, 'created', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:53:43.989Z'::timestamptz, '2026-01-07T17:53:43.989Z'::timestamptz, 1, 'ed1aa5e7-9b16-4355-a4e9-cb0a9cedaee2'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:53:43.989Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F SCMAL0L1Q113 (ESPAÇO KIDS) — device 20913d19-06b1-4d32-aa99-07c28bd71e2c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '20913d19-06b1-4d32-aa99-07c28bd71e2c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Pendente de ajuste no painel)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:20:00.805Z'::timestamptz, '2026-04-03T15:32:12.140Z'::timestamptz, 2, '8b4efb8d-ab2c-4853-aac7-5ed6e9c7c386'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:20:00.805Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:32:12.140Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:32:12.140Z'::timestamptz, '61f27fea-e172-49c1-baec-6d42b1f5c3dc'::uuid
FROM annotations a
WHERE a.legacy_id = '8b4efb8d-ab2c-4853-aac7-5ed6e9c7c386'::uuid AND a.entity_id = '20913d19-06b1-4d32-aa99-07c28bd71e2c'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2AC201KLM (Claro) — device 8afe1fed-1744-470b-bb34-a459835cf2d9 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '8afe1fed-1744-470b-bb34-a459835cf2d9'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Realocação realizada', 'activity', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:52:54.449Z'::timestamptz, '2026-02-03T12:53:04.909Z'::timestamptz, 2, '66bd70b9-5485-4e8d-846a-40663c265589'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:52:54.449Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:53:04.909Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'realocado', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:53:04.909Z'::timestamptz, '96a011f1-7c92-4bae-8449-55ed7ab99b08'::uuid
FROM annotations a
WHERE a.legacy_id = '66bd70b9-5485-4e8d-846a-40663c265589'::uuid AND a.entity_id = '8afe1fed-1744-470b-bb34-a459835cf2d9'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '8afe1fed-1744-470b-bb34-a459835cf2d9'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(PENDENTE REALOCAÇÃO)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:56:38.125Z'::timestamptz, '2026-02-03T12:53:24.013Z'::timestamptz, 2, '0f90eb63-a85f-4814-a396-f8000ff3bb30'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:56:38.125Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:53:24.013Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'realocado antes 110BC_SMART', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-03T12:53:24.013Z'::timestamptz, '13336984-f62f-4595-b46c-f010396f37ae'::uuid
FROM annotations a
WHERE a.legacy_id = '0f90eb63-a85f-4814-a396-f8000ff3bb30'::uuid AND a.entity_id = '8afe1fed-1744-470b-bb34-a459835cf2d9'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2AC201N (RESERVA) — device d36d4003-e0b9-4f52-80a5-790758eea328 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd36d4003-e0b9-4f52-80a5-790758eea328'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Durante a instalação o local estava em obra e foi perdido o equipamento. Foi adicionado um novo sensor, funcionando corretamente', 'observation', 3, 'created', true, '{"id": "76567a90-cf8e-11f0-998e-25174baff087", "email": "dsantana@sacavalcante.com.br", "name": "Daniel Santanna"}'::jsonb, '2026-01-29T18:11:12.473Z'::timestamptz, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:16:57.100Z'::timestamptz, '2026-01-29T18:11:12.473Z'::timestamptz, 2, '8b288caf-0540-4875-8abf-8aa60c1939a3'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:16:57.100Z'::timestamptz),  ('approved', 1, '{"id": "76567a90-cf8e-11f0-998e-25174baff087", "email": "dsantana@sacavalcante.com.br", "name": "Daniel Santanna"}'::jsonb, '2026-01-29T18:11:12.473Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'approved', 'Okay, aprovado!', '{"id": "76567a90-cf8e-11f0-998e-25174baff087", "email": "dsantana@sacavalcante.com.br", "name": "Daniel Santanna"}'::jsonb, '2026-01-29T18:11:12.473Z'::timestamptz, '1010160f-e8c4-49af-823f-5504f4ddddf7'::uuid
FROM annotations a
WHERE a.legacy_id = '8b288caf-0540-4875-8abf-8aa60c1939a3'::uuid AND a.entity_id = 'd36d4003-e0b9-4f52-80a5-790758eea328'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2AC208D (sem nome) — device e70e1ccc-3674-411e-b9b7-b1dd2b89746f ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e70e1ccc-3674-411e-b9b7-b1dd2b89746f'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'loja retirada da exibição, estava na coluna de area comum', 'observation', 3, 'created', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-12T19:46:06.291Z'::timestamptz, '2026-01-12T19:46:06.291Z'::timestamptz, 1, 'f03ffbb9-39b8-4c25-adde-589a580f839d'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-12T19:46:06.291Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F SCMAL2AC208J (SEM LOJA - 208J) — device 1e13c904-30a3-403a-9345-9a697674a829 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '1e13c904-30a3-403a-9345-9a697674a829'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Está com consumo, falta definir a LOJA / ETIQUETA para o LUC 208J', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "37e6b1e0-1fb6-11f0-9baa-8137e6ac9d72", "email": "rodrigo@myio.com.br", "name": "Rodrigo Lago"}'::jsonb, '2026-01-09T15:13:54.041Z'::timestamptz, '2026-04-03T15:39:55.506Z'::timestamptz, 2, 'b813586d-8e2a-425d-9e29-01ae2fe2c589'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "37e6b1e0-1fb6-11f0-9baa-8137e6ac9d72", "email": "rodrigo@myio.com.br", "name": "Rodrigo Lago"}'::jsonb, '2026-01-09T15:13:54.041Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:39:55.506Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'LUC definido, loja a cargo do Shopping', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:39:55.506Z'::timestamptz, '54b347ba-cc3d-4309-ba5a-fa24b87fad88'::uuid
FROM annotations a
WHERE a.legacy_id = 'b813586d-8e2a-425d-9e29-01ae2fe2c589'::uuid AND a.entity_id = '1e13c904-30a3-403a-9345-9a697674a829'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2AC210BC (SIMMONS COLCHOES) — device 30805708-b5c7-442b-b4c1-d84c4dbb0c68 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '30805708-b5c7-442b-b4c1-d84c4dbb0c68'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja Fechada', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:06:05.253Z'::timestamptz, '2026-04-03T15:33:26.818Z'::timestamptz, 2, 'a2496fc0-c590-4dac-bcaa-b642a9beecef'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:06:05.253Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:33:26.818Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:33:26.818Z'::timestamptz, '26bf01a2-13b3-47f4-9c58-0a7d6c19d064'::uuid
FROM annotations a
WHERE a.legacy_id = 'a2496fc0-c590-4dac-bcaa-b642a9beecef'::uuid AND a.entity_id = '30805708-b5c7-442b-b4c1-d84c4dbb0c68'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2AC213A INATIVADO (Artesanato da Terra - INATIVADO) — device 0fa47de9-b75b-4572-baea-cc5a452c59f7 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '0fa47de9-b75b-4572-baea-cc5a452c59f7'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Pendente de ajuste pelo desenvolvimento)', 'observation', 3, 'created', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:56:55.683Z'::timestamptz, '2026-01-07T17:56:55.683Z'::timestamptz, 1, 'ccad2474-891c-466c-b27a-a57e25f0e4f2'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:56:55.683Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F SCMAL2ACBOMBI1 (Bomba de incendio 1 (entender tipo de bomba)) — device d689a53f-44f0-43b3-9126-307321de5b31 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd689a53f-44f0-43b3-9126-307321de5b31'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:34:51.070Z'::timestamptz, '2026-01-30T13:34:51.070Z'::timestamptz, 1, '98d5d466-09fc-447e-a67d-f345402317a7'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:34:51.070Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F SCMAL2ACEL3 (Elevador 3) — device 7e3e6572-3fe0-470d-8b20-87a7da186274 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '7e3e6572-3fe0-470d-8b20-87a7da186274'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'elevador 15', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T19:24:13.437Z'::timestamptz, '2026-04-03T15:11:14.444Z'::timestamptz, 2, 'c4c0baf5-c3e5-4fdf-86b8-31e2c626c32a'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T19:24:13.437Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:11:14.444Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:11:14.444Z'::timestamptz, '0895ba73-d9bf-4da3-b80c-fe8803d664e5'::uuid
FROM annotations a
WHERE a.legacy_id = 'c4c0baf5-c3e5-4fdf-86b8-31e2c626c32a'::uuid AND a.entity_id = '7e3e6572-3fe0-470d-8b20-87a7da186274'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2ACEL4 (Elevador 4) — device e84a161a-acbb-4c7c-af8d-274b904fd1a3 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e84a161a-acbb-4c7c-af8d-274b904fd1a3'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'elevador 8', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T19:24:27.817Z'::timestamptz, '2026-04-03T15:13:03.355Z'::timestamptz, 2, 'bd6afc0d-6f14-438c-aed2-ed6c75f83e40'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T19:24:27.817Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:13:03.355Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:13:03.355Z'::timestamptz, '2347148e-145d-453b-852d-66914ee2a9e3'::uuid
FROM annotations a
WHERE a.legacy_id = 'bd6afc0d-6f14-438c-aed2-ed6c75f83e40'::uuid AND a.entity_id = 'e84a161a-acbb-4c7c-af8d-274b904fd1a3'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2ACEL7 (Elevador 7) — device 36860c96-b2dd-4bb6-858c-f76cc89ce432 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '36860c96-b2dd-4bb6-858c-f76cc89ce432'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Elevador parado, aguardando chegada de peça para manutenção.', 'observation', 3, 'created', false, NULL, NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-05-26T19:43:31.620Z'::timestamptz, '2026-05-26T19:43:31.620Z'::timestamptz, 1, 'bbf0b9ed-572d-4146-a25e-0c4064fa9cc0'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-05-26T19:43:31.620Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F SCMAL2ACQ203B (RAPID PRINT) — device f6393f95-ddf0-4af3-8b6e-e8414beb7b1d ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'f6393f95-ddf0-4af3-8b6e-e8414beb7b1d'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Alterado LUC de Q203B para Q209', 'observation', 2, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:06.906Z'::timestamptz, '2026-04-03T15:43:15.500Z'::timestamptz, 2, '9c034ac9-308a-49e8-a818-5a9aecff7286'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:06.906Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:15.500Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'realizado', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:15.500Z'::timestamptz, '7197baa2-0d6f-4e53-be82-b0d31e37d03e'::uuid
FROM annotations a
WHERE a.legacy_id = '9c034ac9-308a-49e8-a818-5a9aecff7286'::uuid AND a.entity_id = 'f6393f95-ddf0-4af3-8b6e-e8414beb7b1d'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'f6393f95-ddf0-4af3-8b6e-e8414beb7b1d'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Esse medidor é da RapidPrint de LUC Q209', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-15T13:08:13.309Z'::timestamptz, '2026-04-06T14:20:10.553Z'::timestamptz, 2, '04551287-56d5-49f4-97df-feaee5d1820e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-15T13:08:13.309Z'::timestamptz),  ('archived', 1, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-04-06T14:20:10.553Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-04-06T14:20:10.553Z'::timestamptz, 'e6521a93-fd5b-4201-8ede-908218f3a017'::uuid
FROM annotations a
WHERE a.legacy_id = '04551287-56d5-49f4-97df-feaee5d1820e'::uuid AND a.entity_id = 'f6393f95-ddf0-4af3-8b6e-e8414beb7b1d'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2ACQ207A (Praça de eventos L2) — device dcd383f2-566e-4c0a-9e97-7a3b01f00756 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'dcd383f2-566e-4c0a-9e97-7a3b01f00756'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Local localizado', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:13:36.243Z'::timestamptz, '2026-04-03T15:32:58.655Z'::timestamptz, 2, 'f848e41e-5692-4b58-87a1-98e05892520a'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:13:36.243Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:32:58.655Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:32:58.655Z'::timestamptz, '9f242804-087d-422e-a046-c63573ce1f67'::uuid
FROM annotations a
WHERE a.legacy_id = 'f848e41e-5692-4b58-87a1-98e05892520a'::uuid AND a.entity_id = 'dcd383f2-566e-4c0a-9e97-7a3b01f00756'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL2ACQ213 (MR Kids) — device d5327d13-9879-4415-b802-7d094ce80d1e ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd5327d13-9879-4415-b802-7d094ce80d1e'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '( shopping não localizou fonte da alimentação)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:18:25.016Z'::timestamptz, '2026-04-03T15:33:10.019Z'::timestamptz, 2, 'cbd7c140-2e2e-41ec-9314-6451e7f9da67'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:18:25.016Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:33:10.019Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:33:10.019Z'::timestamptz, '4d17fa75-73f6-4c27-8ea2-2aa527d00392'::uuid
FROM annotations a
WHERE a.legacy_id = 'cbd7c140-2e2e-41ec-9314-6451e7f9da67'::uuid AND a.entity_id = 'd5327d13-9879-4415-b802-7d094ce80d1e'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL3L4302D (Espaço Laser) — device d7f081e9-9447-4afd-919a-19d36bae0d1c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd7f081e9-9447-4afd-919a-19d36bae0d1c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Pendente de ajuste no painel)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:22:05.205Z'::timestamptz, '2026-04-03T15:15:13.605Z'::timestamptz, 2, 'af38819a-bfa3-4ab1-b2b5-b2a1f7b534e5'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:22:05.205Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:15:13.605Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:15:13.605Z'::timestamptz, 'f71d9bae-a8a1-4729-b956-cde3946c70e6'::uuid
FROM annotations a
WHERE a.legacy_id = 'af38819a-bfa3-4ab1-b2b5-b2a1f7b534e5'::uuid AND a.entity_id = 'd7f081e9-9447-4afd-919a-19d36bae0d1c'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL3L4302F (Harmonize) — device 86c26bd5-3e3c-46c1-aa80-780b6aaf786c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '86c26bd5-3e3c-46c1-aa80-780b6aaf786c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja Fechada', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:07:32.079Z'::timestamptz, '2026-04-03T15:32:36.904Z'::timestamptz, 2, '8e43f9fb-11de-49bf-9c1b-b39a48ccd0ee'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:07:32.079Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:32:36.904Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:32:36.904Z'::timestamptz, '1db9dc77-1996-4a43-9861-1297ef119822'::uuid
FROM annotations a
WHERE a.legacy_id = '8e43f9fb-11de-49bf-9c1b-b39a48ccd0ee'::uuid AND a.entity_id = '86c26bd5-3e3c-46c1-aa80-780b6aaf786c'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL3L4304G (304G - LOJA FECHADA) — device a6858835-1433-4b83-8277-8ab48d6c1f1c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a6858835-1433-4b83-8277-8ab48d6c1f1c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja retirada da exibição, estava na coluna de area comum', 'observation', 3, 'created', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-12T19:46:41.266Z'::timestamptz, '2026-01-12T19:46:41.266Z'::timestamptz, 1, '9645098e-9800-4772-8030-691899924345'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-12T19:46:41.266Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── 3F SCMAL3L4309GH (BORALÊ) — device f5ba60d1-0eba-42bc-a5d0-36305baa5764 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'f5ba60d1-0eba-42bc-a5d0-36305baa5764'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja Fechada', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:10:45.237Z'::timestamptz, '2026-04-03T15:32:48.204Z'::timestamptz, 2, '97b5f472-1216-407e-b45e-c3b41fafa0a1'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:10:45.237Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:32:48.204Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:32:48.204Z'::timestamptz, '1ceb76b3-9ebe-4c62-af02-fdeff9191a9e'::uuid
FROM annotations a
WHERE a.legacy_id = '97b5f472-1216-407e-b45e-c3b41fafa0a1'::uuid AND a.entity_id = 'f5ba60d1-0eba-42bc-a5d0-36305baa5764'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL3L4313A (Bar do Zeca) — device 1f01672c-8f71-4bf9-989c-7ab98220ad12 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '1f01672c-8f71-4bf9-989c-7ab98220ad12'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja Fechada', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:11:44.789Z'::timestamptz, '2026-04-03T15:16:22.558Z'::timestamptz, 2, '18d62846-ca32-4828-993b-45138faf1273'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:11:44.789Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:16:22.558Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:16:22.558Z'::timestamptz, 'cfcba9b0-1951-48ad-b045-b40890166097'::uuid
FROM annotations a
WHERE a.legacy_id = '18d62846-ca32-4828-993b-45138faf1273'::uuid AND a.entity_id = '1f01672c-8f71-4bf9-989c-7ab98220ad12'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL3L4401 (Vila Park Boliche) — device 12f660cd-957f-4e6a-b7d6-006de541739c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '12f660cd-957f-4e6a-b7d6-006de541739c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'loja fechada', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T18:47:47.453Z'::timestamptz, '2026-04-03T15:34:04.591Z'::timestamptz, 2, '0106f705-686e-4d8a-81bf-5e59d836425b'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T18:47:47.453Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:34:04.591Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:34:04.591Z'::timestamptz, 'fa7b8819-52ae-4df3-8d5c-eb897cbbfb7c'::uuid
FROM annotations a
WHERE a.legacy_id = '0106f705-686e-4d8a-81bf-5e59d836425b'::uuid AND a.entity_id = '12f660cd-957f-4e6a-b7d6-006de541739c'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL3L4Q304B (GOTRIX) — device d15d87ea-ba3c-4c52-aca5-fff3065eec3f ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd15d87ea-ba3c-4c52-aca5-fff3065eec3f'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'virou loja', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:14:03.342Z'::timestamptz, '2026-04-03T15:31:43.994Z'::timestamptz, 2, '3d3ca721-ae9f-4a9d-928c-e47255dd83c3'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-03-04T20:14:03.342Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:31:43.994Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:31:43.994Z'::timestamptz, 'd4682a63-f34e-4003-9378-f5be2ac9ceea'::uuid
FROM annotations a
WHERE a.legacy_id = '3d3ca721-ae9f-4a9d-928c-e47255dd83c3'::uuid AND a.entity_id = 'd15d87ea-ba3c-4c52-aca5-fff3065eec3f'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMAL3L4Q306A (Inplay VR) — device 33af1b5c-f771-46ce-aa30-b7324b04f26b ── 3 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '33af1b5c-f771-46ce-aa30-b7324b04f26b'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Loja Fechada', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-10T03:19:23.407Z'::timestamptz, '2026-04-03T15:43:41.045Z'::timestamptz, 2, 'cb23a275-52e8-47ef-88f4-e0cd185078c8'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-02-10T03:19:23.407Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:41.045Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:41.045Z'::timestamptz, 'a40785a8-2a68-4612-898e-200e912d9943'::uuid
FROM annotations a
WHERE a.legacy_id = 'cb23a275-52e8-47ef-88f4-e0cd185078c8'::uuid AND a.entity_id = '33af1b5c-f771-46ce-aa30-b7324b04f26b'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '33af1b5c-f771-46ce-aa30-b7324b04f26b'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'RETIRAR DO DASHBOARD', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-29T17:55:47.253Z'::timestamptz, '2026-04-03T15:43:45.815Z'::timestamptz, 2, 'b9a6f78a-76cd-48b4-959b-a3c59c13aa43'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-29T17:55:47.253Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:45.815Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:45.815Z'::timestamptz, 'd2ab12c5-4854-4ec7-b42a-ba2f6537bb29'::uuid
FROM annotations a
WHERE a.legacy_id = 'b9a6f78a-76cd-48b4-959b-a3c59c13aa43'::uuid AND a.entity_id = '33af1b5c-f771-46ce-aa30-b7324b04f26b'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '33af1b5c-f771-46ce-aa30-b7324b04f26b'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(pendente de ajuste no desenvolvimento)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:55:51.500Z'::timestamptz, '2026-04-03T15:43:55.461Z'::timestamptz, 2, '8eec5640-8bfc-46f5-83ed-44c8888d9b9e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:55:51.500Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:55.461Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:43:55.461Z'::timestamptz, 'bde25c89-13d8-4d8a-a464-1b89a65e976e'::uuid
FROM annotations a
WHERE a.legacy_id = '8eec5640-8bfc-46f5-83ed-44c8888d9b9e'::uuid AND a.entity_id = '33af1b5c-f771-46ce-aa30-b7324b04f26b'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── 3F SCMALinplayVR (InplayVR) — device ee533328-c0a6-4439-8154-df146a80ab98 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'ee533328-c0a6-4439-8154-df146a80ab98'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Inserir código Q110 para essa medição do Inplay VR', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-12T18:48:45.753Z'::timestamptz, '2026-04-06T14:19:57.975Z'::timestamptz, 2, '8a779de7-4b98-44e0-bd0b-7d46aac3e5a8'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-12T18:48:45.753Z'::timestamptz),  ('archived', 1, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-04-06T14:19:57.975Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-04-06T14:19:57.975Z'::timestamptz, '23cd3966-5696-4946-92ad-690062d4e619'::uuid
FROM annotations a
WHERE a.legacy_id = '8a779de7-4b98-44e0-bd0b-7d46aac3e5a8'::uuid AND a.entity_id = 'ee533328-c0a6-4439-8154-df146a80ab98'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'ee533328-c0a6-4439-8154-df146a80ab98'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Pendente de ajuste no painel)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:21:07.812Z'::timestamptz, '2026-04-03T15:31:15.497Z'::timestamptz, 2, '232b14a7-ece7-4478-a473-9d23c53bf5ba'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:21:07.812Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:31:15.497Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:31:15.497Z'::timestamptz, 'a4206232-3ac0-4519-b82d-82f8f47d42b5'::uuid
FROM annotations a
WHERE a.legacy_id = '232b14a7-ece7-4478-a473-9d23c53bf5ba'::uuid AND a.entity_id = 'ee533328-c0a6-4439-8154-df146a80ab98'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. 104ABCJKL (são Jose Super) — device 51792575-7c2e-4a3a-922f-2f6454e3fc24 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '51792575-7c2e-4a3a-922f-2f6454e3fc24'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:11:44.987Z'::timestamptz, '2026-01-30T17:11:44.987Z'::timestamptz, 1, 'de535fd1-255d-4089-8734-ae4bf70d7ef2'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:11:44.987Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L102A (Faculdade Mandic) — device 11fa9356-1063-41ea-970a-b7eee85e21df ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '11fa9356-1063-41ea-970a-b7eee85e21df'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Faculdade com vazamento, 4 mil litros', 'observation', 3, 'created', false, NULL, NULL, '{"id": "37e6b1e0-1fb6-11f0-9baa-8137e6ac9d72", "email": "rodrigo@myio.com.br", "name": "Rodrigo Lago"}'::jsonb, '2026-03-01T12:33:05.383Z'::timestamptz, '2026-03-01T12:33:05.383Z'::timestamptz, 1, 'e7f4197c-e515-45b3-9312-2bbb2099748a'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "37e6b1e0-1fb6-11f0-9baa-8137e6ac9d72", "email": "rodrigo@myio.com.br", "name": "Rodrigo Lago"}'::jsonb, '2026-03-01T12:33:05.383Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1101 (Cine Araújo) — device a98cac94-168c-4bda-a329-eabbae2e909f ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a98cac94-168c-4bda-a329-eabbae2e909f'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Precisa ser feito o mapeamento desse ponto)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:30:08.621Z'::timestamptz, '2026-04-03T15:47:12.900Z'::timestamptz, 2, '5b3eedb5-c9d6-43fd-ad2b-07ac2a92f195'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-08T13:30:08.621Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:47:12.900Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:47:12.900Z'::timestamptz, '2ce80eb4-f614-4bae-8b10-c5d77f28b6b8'::uuid
FROM annotations a
WHERE a.legacy_id = '5b3eedb5-c9d6-43fd-ad2b-07ac2a92f195'::uuid AND a.entity_id = 'a98cac94-168c-4bda-a329-eabbae2e909f'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a98cac94-168c-4bda-a329-eabbae2e909f'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Precisa ser feito o mapeamento desse ponto', 'pending', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:23:48.266Z'::timestamptz, '2026-01-07T17:38:41.632Z'::timestamptz, 2, '9b6871de-966c-4436-a060-f21875cf563f'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:23:48.266Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-01-07T17:38:41.632Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1102A (vivenda do camarão) — device 945638fd-57a7-4164-88b7-8cc95046933e ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '945638fd-57a7-4164-88b7-8cc95046933e'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de vários dias', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:08:44.252Z'::timestamptz, '2026-01-30T17:08:44.252Z'::timestamptz, 1, 'f2abc35f-2364-44ec-932c-fd9e7e3c8831'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:08:44.252Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1102B (Imperador Burguer) — device c8dec94d-e1b2-499e-a5f8-873bd595838f ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'c8dec94d-e1b2-499e-a5f8-873bd595838f'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:59:29.418Z'::timestamptz, '2026-01-30T16:59:29.418Z'::timestamptz, 1, '0c0eb8d7-9a52-4e48-93a1-edb77c1705dc'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:59:29.418Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1102LM (Móveis Simonetti) — device 97e10ac2-d6a1-456f-a930-19504be376ca ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '97e10ac2-d6a1-456f-a930-19504be376ca'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de alguns dias e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:23:06.079Z'::timestamptz, '2026-01-30T17:23:06.079Z'::timestamptz, 1, '97cf1ff9-b8ab-4042-b7ee-d18b140c7d49'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:23:06.079Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1105C (Chicken Town) — device 58e94534-e997-4a74-b64f-7d08ee07a744 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '58e94534-e997-4a74-b64f-7d08ee07a744'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:13:46.799Z'::timestamptz, '2026-01-30T17:13:46.799Z'::timestamptz, 1, 'f108925e-5c05-47a8-9c87-3f22bc7fcf4d'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:13:46.799Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1107B (Milky Moo) — device 8c945215-3483-4ee0-962a-d8ae4e97296a ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '8c945215-3483-4ee0-962a-d8ae4e97296a'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:09:58.390Z'::timestamptz, '2026-01-30T17:09:58.390Z'::timestamptz, 1, '399119dd-2782-43cf-b9ff-4b0fd2283904'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:09:58.390Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1107C (CHIQUINHO SORVETES) — device 452b452c-c872-4a88-9d71-1bee17e7b6d2 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '452b452c-c872-4a88-9d71-1bee17e7b6d2'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Loja Fechada em obra, futuramente será Chiquinho Sorvetes)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:05:10.423Z'::timestamptz, '2026-04-03T15:51:16.475Z'::timestamptz, 2, '0034ed25-8821-4036-82bc-8367eece2540'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:05:10.423Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:51:16.475Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:51:16.475Z'::timestamptz, '71523a23-1ee0-481c-bd35-68fb0cd9fd5b'::uuid
FROM annotations a
WHERE a.legacy_id = '0034ed25-8821-4036-82bc-8367eece2540'::uuid AND a.entity_id = '452b452c-c872-4a88-9d71-1bee17e7b6d2'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL0L1107D (Grilleto) — device 40b42b05-1094-4b56-ab34-4312e83c8f0d ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '40b42b05-1094-4b56-ab34-4312e83c8f0d'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:57:42.704Z'::timestamptz, '2026-01-30T16:57:42.704Z'::timestamptz, 1, '88645ac9-46aa-4919-a721-da7b458bfb8e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:57:42.704Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1110A (Lojas Americanas) — device b6ef42ca-8b39-4cc1-87f2-d5299c27cff8 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b6ef42ca-8b39-4cc1-87f2-d5299c27cff8'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:04:37.133Z'::timestamptz, '2026-01-30T17:04:37.133Z'::timestamptz, 1, 'd34f3909-692e-46f9-8a62-3dc790010c03'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:04:37.133Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1110D (ICE ROLL 110D) — device a4446b6d-d6b8-4aa1-801f-83a1f2bb6999 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a4446b6d-d6b8-4aa1-801f-83a1f2bb6999'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:07:47.505Z'::timestamptz, '2026-01-30T17:07:47.505Z'::timestamptz, 1, '09d928d1-b79c-4a90-b84e-aa9d977a6bdd'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:07:47.505Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1113A (Choe´s) — device b6bd1f85-85a6-427b-9cc9-43ac5a1a48ea ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b6bd1f85-85a6-427b-9cc9-43ac5a1a48ea'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T15:42:23.838Z'::timestamptz, '2026-01-30T15:42:23.838Z'::timestamptz, 1, '75b63c0f-2c7e-4aa4-94db-dfee5f3df6fd'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T15:42:23.838Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1113CD (Burguer  king) — device d615b0a1-8a2b-4cc4-85b2-2fcca7a8656c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd615b0a1-8a2b-4cc4-85b2-2fcca7a8656c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:09:42.785Z'::timestamptz, '2026-01-30T17:09:42.785Z'::timestamptz, 1, '09d9126b-e1c7-4c7d-95b8-7c547f87fc00'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:09:42.785Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1114C (Subway) — device a2196e14-ef3c-4c39-8e88-ccec1e79a47c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a2196e14-ef3c-4c39-8e88-ccec1e79a47c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:03:52.610Z'::timestamptz, '2026-01-30T17:03:52.610Z'::timestamptz, 1, '0a8c8988-f5a0-4a6a-b61d-6da8d9d1f99e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:03:52.610Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1114D (Farinella) — device c85451d9-c36b-4d8a-abe4-761293dd3d80 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'c85451d9-c36b-4d8a-abe4-761293dd3d80'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:03:35.100Z'::timestamptz, '2026-01-30T17:03:35.100Z'::timestamptz, 1, 'e5d6ee7f-567a-49d5-8f95-413ef0a56ab0'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:03:35.100Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1115A (Cosechas) — device 0ab1a774-97ec-4766-989a-66f5a47104d1 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '0ab1a774-97ec-4766-989a-66f5a47104d1'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:06:14.063Z'::timestamptz, '2026-01-30T17:06:14.063Z'::timestamptz, 1, '5488f7cf-08fa-49a9-8aca-6865ec0ad503'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:06:14.063Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1115HI (Yaz Docerias) — device 855447be-0c73-4370-bf48-e2f9f2b9887c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '855447be-0c73-4370-bf48-e2f9f2b9887c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de vários dias e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:22:03.110Z'::timestamptz, '2026-01-30T17:22:03.110Z'::timestamptz, 1, '9ed21e68-7615-412b-98d2-bdead0e875da'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:22:03.110Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1115J (Pipocando) — device e0b1915b-ac3e-4a8f-ac2c-398cdd05d810 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e0b1915b-ac3e-4a8f-ac2c-398cdd05d810'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição do dia 30 e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:26:00.515Z'::timestamptz, '2026-01-30T17:26:00.515Z'::timestamptz, 1, 'b53e1e80-83d0-451c-9e95-057b6fe31da9'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:26:00.515Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1116BC (Casas Bahia) — device 8f47e2f0-fcd3-4c2d-9d63-1e681581609f ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '8f47e2f0-fcd3-4c2d-9d63-1e681581609f'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:14:51.328Z'::timestamptz, '2026-01-30T17:14:51.328Z'::timestamptz, 1, 'cffe9c54-7f03-4247-9860-6fc9375deb26'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:14:51.328Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL0L1116G (Multcoisas) — device 3cf9d20c-fc8a-4fbb-88f4-3bb07a7a6c06 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '3cf9d20c-fc8a-4fbb-88f4-3bb07a7a6c06'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de alguns dias e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:26:32.500Z'::timestamptz, '2026-01-30T17:26:32.500Z'::timestamptz, 1, '0aef7dec-fd99-4804-b6cc-af7554f42e34'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:26:32.500Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC201A (Avenida) — device efb65380-8f66-4dda-915a-a47a6b875085 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'efb65380-8f66-4dda-915a-a47a6b875085'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de alguns dias e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:15:17.007Z'::timestamptz, '2026-01-30T17:15:17.007Z'::timestamptz, 1, '371db5ea-00d4-4631-97d3-db98bb75460a'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:15:17.007Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC201C (Sipolatti) — device 3a8966c5-64ce-4164-98cd-a1ee07944d73 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '3a8966c5-64ce-4164-98cd-a1ee07944d73'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Medidor Off e sem medição de alguns dias', 'pending', 3, 'modified', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:38:52.030Z'::timestamptz, '2026-01-30T15:38:07.587Z'::timestamptz, 2, '2010cb97-41c5-4ff6-8bb2-3c7f4ac17db6'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:38:52.030Z'::timestamptz),  ('modified', 1, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T15:38:07.587Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC201GH (Cafeteria do Mestre) — device 2a8ccea4-5891-455e-a690-622eae78c2be ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '2a8ccea4-5891-455e-a690-622eae78c2be'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:07:15.784Z'::timestamptz, '2026-01-30T17:07:15.784Z'::timestamptz, 1, 'e59df625-d3c7-4d48-961d-0d53a8c91f6f'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:07:15.784Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC201STUV (Loucic Uniformes) — device 0d6fca87-ffc4-4ecd-a1cf-9227748d0263 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '0d6fca87-ffc4-4ecd-a1cf-9227748d0263'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de alguns dias e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:17:14.068Z'::timestamptz, '2026-01-30T17:17:14.068Z'::timestamptz, 1, '6d757ded-ef71-4646-80ce-001b7f053999'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:17:14.068Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC203 (Riachuelo) — device 957825ad-0083-4ae3-8fc8-a36ed5b035bc ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '957825ad-0083-4ae3-8fc8-a36ed5b035bc'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:55:06.078Z'::timestamptz, '2026-01-30T16:55:06.078Z'::timestamptz, 1, '95e38342-b38a-4b8e-b80d-3d439203b090'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:55:06.078Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC205BC (Clinica Habilitar) — device 739ecf16-bc31-41b6-972d-5fed81be0a1d ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '739ecf16-bc31-41b6-972d-5fed81be0a1d'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de vários dias', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:11:19.685Z'::timestamptz, '2026-01-30T17:11:19.685Z'::timestamptz, 1, 'aecffe7a-19d2-45d6-83e0-617ecc419935'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:11:19.685Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC205HIJ (RI Happy) — device 1b2ebebd-97a0-4228-af61-55bbc0472d8b ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '1b2ebebd-97a0-4228-af61-55bbc0472d8b'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de vários dias', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:38:16.699Z'::timestamptz, '2026-01-30T13:38:16.699Z'::timestamptz, 1, 'c1c4a04f-d18d-46e1-8395-6c78fcf22033'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:38:16.699Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC205KL (EMPÓRIO MAIA) — device 02e580c9-df28-4d0b-b156-c6fdb359d453 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '02e580c9-df28-4d0b-b156-c6fdb359d453'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de alguns dias e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:19:23.451Z'::timestamptz, '2026-01-30T17:19:23.451Z'::timestamptz, 1, 'e6ba2f40-1b53-4f75-b7ca-d073452413a5'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:19:23.451Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC205MN (Le Biscuit) — device 59600fd2-c57c-4d9d-824e-cd0521c00260 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '59600fd2-c57c-4d9d-824e-cd0521c00260'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição do dia 11 e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:16:25.977Z'::timestamptz, '2026-01-30T17:16:25.977Z'::timestamptz, 1, '44562c4b-4685-4d30-99bf-25375698a74f'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:16:25.977Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC209E (Puket) — device 798db98d-a16a-4fd3-a249-dbecb6087c51 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '798db98d-a16a-4fd3-a249-dbecb6087c51'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Medidor Off e sem medição de vários dias', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:40:04.311Z'::timestamptz, '2026-01-30T13:40:04.311Z'::timestamptz, 1, '88e5c73b-1bc0-4e93-9c5e-675358dcfed1'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:40:04.311Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2AC212BCD (Rede Inova) — device b389aa3f-8896-4209-9e85-ae0640f5fa55 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b389aa3f-8896-4209-9e85-ae0640f5fa55'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem consumo de alguns dias e sem consumo em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:24:25.572Z'::timestamptz, '2026-01-30T17:24:25.572Z'::timestamptz, 1, '1a50ee25-62e1-41c2-bbaa-3db342bf9243'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:24:25.572Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b389aa3f-8896-4209-9e85-ae0640f5fa55'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(VERIFICAR SENSOR)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:11:25.785Z'::timestamptz, '2026-04-06T14:21:08.626Z'::timestamptz, 2, '0532d462-9693-4f68-83ee-b4b02f26d8e4'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:11:25.785Z'::timestamptz),  ('archived', 1, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-04-06T14:21:08.626Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-04-06T14:21:08.626Z'::timestamptz, 'e011f28e-2afe-4b66-9c1a-68e946460ff8'::uuid
FROM annotations a
WHERE a.legacy_id = '0532d462-9693-4f68-83ee-b4b02f26d8e4'::uuid AND a.entity_id = 'b389aa3f-8896-4209-9e85-ae0640f5fa55'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL2ACACHICEBAL1 (AC- Hidrometro Cesan Banheiros L1) — device 3c7fd801-da25-4b3c-888d-ff92a03c9b68 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '3c7fd801-da25-4b3c-888d-ff92a03c9b68'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição', 'pending', 4, 'modified', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T15:34:39.467Z'::timestamptz, '2026-01-30T15:35:46.115Z'::timestamptz, 2, 'c9c60d79-02fd-4519-93e4-d48c72f0980f'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T15:34:39.467Z'::timestamptz),  ('modified', 1, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T15:35:46.115Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '3c7fd801-da25-4b3c-888d-ff92a03c9b68'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:37:27.885Z'::timestamptz, '2026-01-30T13:37:27.885Z'::timestamptz, 1, 'e09c0044-bb1a-43fe-8ab4-f9f3fa1f2256'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:37:27.885Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2ACACHINABAL1 (AC- Hidrometro  Nascente para banheiros L1) — device 74a193b0-9031-4d5b-a2e5-91ceda1a664a ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '74a193b0-9031-4d5b-a2e5-91ceda1a664a'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição na maioria das horas, e valor das medições muito diferente da real demanda de água desse local', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T18:38:08.434Z'::timestamptz, '2026-01-30T18:38:08.434Z'::timestamptz, 1, 'd88fe1aa-3bd8-4ab9-992d-0c36c95c92dd'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T18:38:08.434Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2ACACHINABAL3 (AC- Hidrometro Nascente Banheiros L3) — device 8604db12-c22f-41e6-8c34-82f86038217d ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '8604db12-c22f-41e6-8c34-82f86038217d'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição na maioria das horas, e valor das medições muito diferente da real demanda de água desse local', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T18:37:43.645Z'::timestamptz, '2026-01-30T18:37:43.645Z'::timestamptz, 1, 'cf97998b-6d45-4d39-aeeb-6540221e8aa9'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T18:37:43.645Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2ACACHINATORE (CESAN TORRE DE RESFRIAMENTO) — device a3296240-a933-43b1-9ebf-5f7ba5b47028 ── 4 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a3296240-a933-43b1-9ebf-5f7ba5b47028'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'alterado de AC- Hidrometro Nascente T.orres Resfriamento (G7) para CESAN TORRE DE RESFRIAMENTO', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:18:13.799Z'::timestamptz, '2026-05-19T19:18:31.620Z'::timestamptz, 2, '3caeb37a-9959-4629-b0b1-c0cf3122f4c2'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:18:13.799Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:18:31.620Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'Alteração atualizada', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:18:31.620Z'::timestamptz, 'd50f40e9-37f2-4041-bb24-e41a62bf3f4e'::uuid
FROM annotations a
WHERE a.legacy_id = '3caeb37a-9959-4629-b0b1-c0cf3122f4c2'::uuid AND a.entity_id = 'a3296240-a933-43b1-9ebf-5f7ba5b47028'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a3296240-a933-43b1-9ebf-5f7ba5b47028'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'alterado de AC- Hidrometro Nascente T.orres Resfriamento (G7) para CESAN TAG', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:09:31.093Z'::timestamptz, '2026-05-19T19:09:39.254Z'::timestamptz, 2, '9af4e2f4-7a90-4e87-98e2-b0fc07b7dae7'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:09:31.093Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:09:39.254Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'FEITO', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:09:39.254Z'::timestamptz, '679d478d-0402-4919-ad29-50394c0bbd00'::uuid
FROM annotations a
WHERE a.legacy_id = '9af4e2f4-7a90-4e87-98e2-b0fc07b7dae7'::uuid AND a.entity_id = 'a3296240-a933-43b1-9ebf-5f7ba5b47028'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a3296240-a933-43b1-9ebf-5f7ba5b47028'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Foi enviada a localização dos pontos dos hidrômetros de área comum em relatório', 'pending', 3, 'created', false, NULL, NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-03-03T21:33:29.297Z'::timestamptz, '2026-03-03T21:33:29.297Z'::timestamptz, 1, 'acc31a0e-b6a9-4fcb-a0cb-9b3a96fa8a24'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-03-03T21:33:29.297Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'a3296240-a933-43b1-9ebf-5f7ba5b47028'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:36:32.396Z'::timestamptz, '2026-01-30T13:36:32.396Z'::timestamptz, 1, '0feae63e-342b-4c36-96bb-f03d6499cc82'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:36:32.396Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2ACACHIPRNA (AC- Hidrômetro Principal Nascente) — device e0bc3fb7-dfd2-4f69-b6e6-9e8d6bb30273 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e0bc3fb7-dfd2-4f69-b6e6-9e8d6bb30273'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'offline', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:25:16.790Z'::timestamptz, '2026-04-03T15:45:39.654Z'::timestamptz, 2, '5b6ac140-50e4-4f8a-a0d4-8e63afeb9758'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:25:16.790Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:45:39.654Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:45:39.654Z'::timestamptz, 'a8b86fc1-e081-4220-a6f6-186a8f1f4c28'::uuid
FROM annotations a
WHERE a.legacy_id = '5b6ac140-50e4-4f8a-a0d4-8e63afeb9758'::uuid AND a.entity_id = 'e0bc3fb7-dfd2-4f69-b6e6-9e8d6bb30273'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL2ACACHIPUÁGCOUR (AC- Hidrometro purga de água condensada UR01 (Precisa ser feito o mapeamento desse ponto)) — device b8abdd64-2690-48f4-86d7-e96aa2e5af66 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b8abdd64-2690-48f4-86d7-e96aa2e5af66'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:36:58.433Z'::timestamptz, '2026-01-30T13:36:58.433Z'::timestamptz, 1, '4834cf61-a71a-40d1-af74-ec6f4150271b'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:36:58.433Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2ACACHIPUÁGCOUR_2 (AC- Hidrometro purga de água condensada UR02) — device c90e0163-8833-4315-80bf-48bd77aefee6 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'c90e0163-8833-4315-80bf-48bd77aefee6'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:44:44.988Z'::timestamptz, '2026-01-30T13:44:44.988Z'::timestamptz, 1, '22981315-103f-4472-9cae-469ac060ee30'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:44:44.988Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2ACACHITA (AC- Hidrometro TAG) — device e46e0faf-3aed-4536-87f3-480d9eef4cd0 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e46e0faf-3aed-4536-87f3-480d9eef4cd0'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'ALTERADO DE AC- Hidrometro TAG para HIDROMETRO NASCENTE TAG', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:11:11.026Z'::timestamptz, '2026-05-19T19:11:16.752Z'::timestamptz, 2, 'ae43b5e7-ce07-4c36-b84a-22386aa0c3c3'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:11:11.026Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:11:16.752Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'FEITO', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:11:16.752Z'::timestamptz, '0780bcb2-83ea-4207-a535-0cbce58fae95'::uuid
FROM annotations a
WHERE a.legacy_id = 'ae43b5e7-ce07-4c36-b84a-22386aa0c3c3'::uuid AND a.entity_id = 'e46e0faf-3aed-4536-87f3-480d9eef4cd0'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e46e0faf-3aed-4536-87f3-480d9eef4cd0'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:37:13.561Z'::timestamptz, '2026-01-30T13:37:13.561Z'::timestamptz, 1, 'e35f8484-c216-4ae9-985d-4a94a2dc650b'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T13:37:13.561Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL2ACACHITACETORE (HIDROMETROS NASCENTE TORRE DE RESFRIAMENTO) — device 8ae6f555-00ce-41de-9991-e1338b78395c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '8ae6f555-00ce-41de-9991-e1338b78395c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'ALTERADO DE AC - Hidrômetro Cesan para torres de resfriamento para HIDROMETROS NASCENTE TORRE DE RESFRIAMENTO', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:15:58.639Z'::timestamptz, '2026-05-19T19:16:05.354Z'::timestamptz, 2, '409f2141-5c41-4e93-94e0-18ea99899bd8'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:15:58.639Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:16:05.354Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', 'FEITO', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-05-19T19:16:05.354Z'::timestamptz, 'ac45180e-4f52-4e39-a81a-80122000181f'::uuid
FROM annotations a
WHERE a.legacy_id = '409f2141-5c41-4e93-94e0-18ea99899bd8'::uuid AND a.entity_id = '8ae6f555-00ce-41de-9991-e1338b78395c'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL2ACQ210 (Bob´s Quiosque) — device 72ecb033-51d9-4ec7-9592-097ff4ae1a0a ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '72ecb033-51d9-4ec7-9592-097ff4ae1a0a'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:10:50.389Z'::timestamptz, '2026-01-30T17:10:50.389Z'::timestamptz, 1, '573266e3-b4ce-45f3-b6de-c1ec4bc31900'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:10:50.389Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4301D (CHeirin Bão) — device 4b5e21ad-30fc-48f1-95c1-a98dfcb107ac ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '4b5e21ad-30fc-48f1-95c1-a98dfcb107ac'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(LOJA FECHADA)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:05:28.357Z'::timestamptz, '2026-04-03T15:50:42.095Z'::timestamptz, 2, 'bf5e0841-7e66-4b2d-9837-5acddd2e9260'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:05:28.357Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:50:42.095Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:50:42.095Z'::timestamptz, '20f55c15-5926-4ddd-a656-ac84f4bd762f'::uuid
FROM annotations a
WHERE a.legacy_id = 'bf5e0841-7e66-4b2d-9837-5acddd2e9260'::uuid AND a.entity_id = '4b5e21ad-30fc-48f1-95c1-a98dfcb107ac'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL3L4301G (L´occitane) — device 91e5510a-9730-43a5-b8c5-0e22caaa7053 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '91e5510a-9730-43a5-b8c5-0e22caaa7053'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de alguns dias e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:22:30.150Z'::timestamptz, '2026-01-30T17:22:30.150Z'::timestamptz, 1, '884032fb-a9de-45d2-930d-78499b35ae9c'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:22:30.150Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '91e5510a-9730-43a5-b8c5-0e22caaa7053'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Pendente de ajuste no painel)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:11:08.973Z'::timestamptz, '2026-04-03T15:50:06.573Z'::timestamptz, 2, 'f616045f-e715-48a1-8839-dcf17e06afe6'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:11:08.973Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:50:06.573Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:50:06.573Z'::timestamptz, '26128445-e258-4a34-8276-bb3ab7127866'::uuid
FROM annotations a
WHERE a.legacy_id = 'f616045f-e715-48a1-8839-dcf17e06afe6'::uuid AND a.entity_id = '91e5510a-9730-43a5-b8c5-0e22caaa7053'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL3L4302AB (Boticario) — device 218a1641-4c37-4abe-8234-5320af8fffdf ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '218a1641-4c37-4abe-8234-5320af8fffdf'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição do dia 11 e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:21:11.677Z'::timestamptz, '2026-01-30T17:21:11.677Z'::timestamptz, 1, 'e9f42302-c65d-4e01-b292-ad81cf83ac5d'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:21:11.677Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4302D (Espaço Laser) — device b5e05c54-e890-46d2-b361-e6b21382bd78 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'b5e05c54-e890-46d2-b361-e6b21382bd78'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Necessário ajustar, leitura de consumo com falha', 'maintenance', 4, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-13T21:52:38.237Z'::timestamptz, '2026-01-13T21:52:38.237Z'::timestamptz, 1, 'ef6bb22d-d1da-4c86-8d8c-260abdeaadde'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-13T21:52:38.237Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4303J (Oticas Diniz) — device d43d3361-5171-4ec9-97cb-dc4f1a40089e ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd43d3361-5171-4ec9-97cb-dc4f1a40089e'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:14:06.486Z'::timestamptz, '2026-01-30T17:14:06.486Z'::timestamptz, 1, '22a94d91-a6c3-45d3-a0c9-1168233ee036'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:14:06.486Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4304ABC (Marisa (água)) — device bc4cdc3b-2a5a-4b06-95f7-d37bd6748c1d ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'bc4cdc3b-2a5a-4b06-95f7-d37bd6748c1d'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de vários dias e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:26:58.604Z'::timestamptz, '2026-01-30T17:26:58.604Z'::timestamptz, 1, '57e330f0-7e8f-42fb-a292-1b93761542d9'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:26:58.604Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4306ANO (Renner) — device 6526b1c9-5cce-4e70-bc47-66c624e8d74c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '6526b1c9-5cce-4e70-bc47-66c624e8d74c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:54:18.543Z'::timestamptz, '2026-01-30T16:54:18.543Z'::timestamptz, 1, 'bbe69cb5-deda-4263-ac0e-f4c65c271a4e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:54:18.543Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4306P (Borelli) — device fe8d3c5e-4d34-4812-9b06-26bda1158d97 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'fe8d3c5e-4d34-4812-9b06-26bda1158d97'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:04:11.480Z'::timestamptz, '2026-01-30T17:04:11.480Z'::timestamptz, 1, '10eef7b9-da64-42dd-a9a6-b9e927d82881'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:04:11.480Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4307G (Kopenhagen) — device ba8f743b-0dc3-41fb-ad14-80a24a324bd6 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'ba8f743b-0dc3-41fb-ad14-80a24a324bd6'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:13:19.334Z'::timestamptz, '2026-01-30T17:13:19.334Z'::timestamptz, 1, '02b058b7-8598-4d41-9f39-3eeb8c076e26'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:13:19.334Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4307I (Let´s Esmalteria) — device d5b76b97-0ecc-4a0c-bd7d-dcc9e1245f4a ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd5b76b97-0ecc-4a0c-bd7d-dcc9e1245f4a'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição do dia 12 e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:18:02.079Z'::timestamptz, '2026-01-30T17:18:02.079Z'::timestamptz, 1, '925d66d2-6f07-401c-9dc0-61de8d3ae3b1'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:18:02.079Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'd5b76b97-0ecc-4a0c-bd7d-dcc9e1245f4a'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(Pendente de ajuste no painel)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:11:48.266Z'::timestamptz, '2026-04-03T15:49:21.451Z'::timestamptz, 2, '8b015bf9-313a-46b1-9df6-613d45e2bb2d'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:11:48.266Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:49:21.451Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:49:21.451Z'::timestamptz, 'ac7998b7-1cdc-404d-9c38-8d5f4f89ea55'::uuid
FROM annotations a
WHERE a.legacy_id = '8b015bf9-313a-46b1-9df6-613d45e2bb2d'::uuid AND a.entity_id = 'd5b76b97-0ecc-4a0c-bd7d-dcc9e1245f4a'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL3L4308F (Coelhinho Sorveteria italiana) — device 4f2abda0-e9ca-47c7-b7ca-58bfbefa597e ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '4f2abda0-e9ca-47c7-b7ca-58bfbefa597e'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:13:03.701Z'::timestamptz, '2026-01-30T17:13:03.701Z'::timestamptz, 1, 'eafa09ca-1614-448d-a642-41149a257f4f'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:13:03.701Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4308G (oticas carol) — device 7218df55-5cde-4cb6-a476-27211c6e1bf0 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '7218df55-5cde-4cb6-a476-27211c6e1bf0'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:20:26.413Z'::timestamptz, '2026-01-30T17:20:26.413Z'::timestamptz, 1, '78d1fa03-96dd-452d-aad5-67ca6464dfac'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:20:26.413Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '7218df55-5cde-4cb6-a476-27211c6e1bf0'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(VERIFICAR SENSOR)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:12:07.883Z'::timestamptz, '2026-04-03T15:49:46.112Z'::timestamptz, 2, '9b3f0a57-1662-44c8-be52-50b2765babd7'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:12:07.883Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:49:46.112Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:49:46.112Z'::timestamptz, '83e47eec-385e-4261-8d78-04dc8f4b8c8a'::uuid
FROM annotations a
WHERE a.legacy_id = '9b3f0a57-1662-44c8-be52-50b2765babd7'::uuid AND a.entity_id = '7218df55-5cde-4cb6-a476-27211c6e1bf0'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL3L4309A (Jacklanyne Joias) — device 6aa29dcb-a932-4a99-ab03-6fdafb154488 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '6aa29dcb-a932-4a99-ab03-6fdafb154488'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:15:53.077Z'::timestamptz, '2026-01-30T17:15:53.077Z'::timestamptz, 1, 'd7831328-e011-4c09-925f-6d872147044e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:15:53.077Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4311 (take Kids) — device 5b8ed194-3c42-4b3f-b782-f54e74b83996 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '5b8ed194-3c42-4b3f-b782-f54e74b83996'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:04:58.646Z'::timestamptz, '2026-01-30T17:04:58.646Z'::timestamptz, 1, '505ee363-d75a-4c12-8123-fdbb48499339'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:04:58.646Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4313A (Novo Bar do Zeca) — device 95ef4bba-6327-48bf-93df-2454f2a9023e ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '95ef4bba-6327-48bf-93df-2454f2a9023e'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(LOJA FECHADA)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:04:12.158Z'::timestamptz, '2026-04-03T15:47:25.781Z'::timestamptz, 2, 'd43cb1eb-adb8-44a9-8597-2e1e6141458a'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:04:12.158Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:47:25.781Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:47:25.781Z'::timestamptz, 'ecdfc766-f3ec-4a50-a464-8f59003790fb'::uuid
FROM annotations a
WHERE a.legacy_id = 'd43cb1eb-adb8-44a9-8597-2e1e6141458a'::uuid AND a.entity_id = '95ef4bba-6327-48bf-93df-2454f2a9023e'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL3L4401 (vila Park Boliche) — device 6255116e-3c74-40a6-8f86-e69ffdc9e5cd ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '6255116e-3c74-40a6-8f86-e69ffdc9e5cd'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:55:49.397Z'::timestamptz, '2026-01-30T16:55:49.397Z'::timestamptz, 1, '554b0068-7210-4332-8b00-1272290d7258'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T16:55:49.397Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4EC002 (PITT STOP) — device 07fe84db-75fe-440a-ac15-3a200678c61a ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '07fe84db-75fe-440a-ac15-3a200678c61a'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição em vários dias', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:06:52.708Z'::timestamptz, '2026-01-30T17:06:52.708Z'::timestamptz, 1, '4299c975-674e-4572-a55c-beb9b6729a2d'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:06:52.708Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4Q305 (Bob's Q305) — device 7b8a732e-5750-4062-98c6-64dd128afc68 ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '7b8a732e-5750-4062-98c6-64dd128afc68'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Foi solicitado a retirada da dashboard e também cancelada a instalação, porém teve o pedido de instalação no dia 28/11', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:27:17.961Z'::timestamptz, '2026-04-03T15:48:05.118Z'::timestamptz, 2, '67109937-3a88-4845-9ac7-bf38a36267ac'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T17:27:17.961Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:48:05.118Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:48:05.118Z'::timestamptz, '325d1398-b8d0-4eba-afbf-126bdf7364dc'::uuid
FROM annotations a
WHERE a.legacy_id = '67109937-3a88-4845-9ac7-bf38a36267ac'::uuid AND a.entity_id = '7b8a732e-5750-4062-98c6-64dd128afc68'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── HIDR. SCMAL3L4Q307 (MC Café Quiosque) — device dac44277-ecc7-45f9-824f-4a44dc68627c ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'dac44277-ecc7-45f9-824f-4a44dc68627c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Sem medição de dia 19 e consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'modified', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:12:18.863Z'::timestamptz, '2026-01-30T17:12:42.559Z'::timestamptz, 2, '0db56ce0-391c-408a-b22e-c699f8a6bfc2'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:12:18.863Z'::timestamptz),  ('modified', 1, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:12:42.559Z'::timestamptz)
) AS v(action, prev, actor, ts);

-- ── HIDR. SCMAL3L4Q312 (zé coxinha Quiosque) — device e543219d-c7a7-409d-a670-b5e764a21b61 ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e543219d-c7a7-409d-a670-b5e764a21b61'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Consumo off em algumas horas, deixando diferença no consumo do dia', 'pending', 3, 'created', false, NULL, NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:15:35.060Z'::timestamptz, '2026-01-30T17:15:35.060Z'::timestamptz, 1, 'de1ff9bd-39d5-4321-b42a-be7a3ea00fca'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-30T17:15:35.060Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = 'e543219d-c7a7-409d-a670-b5e764a21b61'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(VERIFICAR SENSOR)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:12:27.528Z'::timestamptz, '2026-04-03T15:49:04.729Z'::timestamptz, 2, '31266b38-c0eb-4b0e-9fba-c5f88c8d99b2'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:12:27.528Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:49:04.729Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:49:04.729Z'::timestamptz, '243055b4-5348-4f8b-aeea-f94fb45e1431'::uuid
FROM annotations a
WHERE a.legacy_id = '31266b38-c0eb-4b0e-9fba-c5f88c8d99b2'::uuid AND a.entity_id = 'e543219d-c7a7-409d-a670-b5e764a21b61'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── Hidr. SCMAQ306_L3 (Ale Pudim.) — device 9451a8c8-0d9b-48de-b9df-67079ffa3a6b ── 1 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '9451a8c8-0d9b-48de-b9df-67079ffa3a6b'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', '(CANCELADA A INSTALAÇÃO)', 'observation', 3, 'archived', false, NULL, NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:08:41.231Z'::timestamptz, '2026-04-03T15:49:32.806Z'::timestamptz, 2, 'ffa4253d-e7ca-4409-babc-1d9cad6319eb'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "42ded7d0-aaad-11f0-afe1-175479a33d89", "email": "estevanroborges@myio.com.br", "name": "Estevan Borges"}'::jsonb, '2026-01-07T18:08:41.231Z'::timestamptz),  ('archived', 1, '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:49:32.806Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'archived', '.', '{"id": "e89aa980-460b-11f0-9291-41f94c09a8a6", "email": "gadioli@myio.com.br", "name": "Leandro Gadioli"}'::jsonb, '2026-04-03T15:49:32.806Z'::timestamptz, '3a763746-c489-49b2-ac4c-3bbfef3bfda2'::uuid
FROM annotations a
WHERE a.legacy_id = 'ffa4253d-e7ca-4409-babc-1d9cad6319eb'::uuid AND a.entity_id = '9451a8c8-0d9b-48de-b9df-67079ffa3a6b'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

-- ── TEMP. SCMAL2ACAC-Temp6 (Temperatura 6 (Passarela)) — device 9eb75b77-c9b8-4ff6-9acb-952f43321e4c ── 2 annotation(s)

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '9eb75b77-c9b8-4ff6-9acb-952f43321e4c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Medidor com problema, temperatura registrada incoerente', 'pending', 4, 'created', false, NULL, NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-08T22:16:16.316Z'::timestamptz, '2026-04-08T22:16:16.316Z'::timestamptz, 1, '2076449c-a94a-458d-bce1-be1c2303e15e'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "21169bd0-58da-11f0-9291-41f94c09a8a6", "email": "alessandro.silva@sacavalcante.com.br", "name": "Alessandro Silva"}'::jsonb, '2026-04-08T22:16:16.316Z'::timestamptz)
) AS v(action, prev, actor, ts);

WITH dev AS (
  SELECT id, tenant_id, customer_id FROM devices WHERE id = '9eb75b77-c9b8-4ff6-9acb-952f43321e4c'
), ins AS (
  INSERT INTO annotations (tenant_id, customer_id, entity_type, entity_id, schema_version, text, type, importance, status, acknowledged, acknowledged_by, acknowledged_at, created_by, created_at, updated_at, version, legacy_id)
  SELECT dev.tenant_id, dev.customer_id, 'device', dev.id, '1.0.0', 'Medidor com status Off-line', 'maintenance', 3, 'created', true, '{"id": "07d89480-e7e7-11ee-8327-cfc6eea1d65a", "email": "bruno@myio.com.br", "name": "Bruno Dantas"}'::jsonb, '2026-03-01T23:35:57.570Z'::timestamptz, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-12T17:27:31.723Z'::timestamptz, '2026-03-01T23:35:57.570Z'::timestamptz, 2, '45e9d98a-8d70-49e6-a7e6-d763574576cf'::uuid
  FROM dev
  ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING
  RETURNING id, tenant_id
)
INSERT INTO annotation_events (tenant_id, annotation_id, action, previous_version, actor, created_at)
SELECT ins.tenant_id, ins.id, v.action, v.prev::int, v.actor, v.ts
FROM ins CROSS JOIN (VALUES
  ('created', NULL, '{"id": "24b8f740-9fa4-11f0-afe1-175479a33d89", "email": "emilio.wetler@sacavalcante.com.br", "name": "Emilio Wetler"}'::jsonb, '2026-01-12T17:27:31.723Z'::timestamptz),  ('approved', 1, '{"id": "07d89480-e7e7-11ee-8327-cfc6eea1d65a", "email": "bruno@myio.com.br", "name": "Bruno Dantas"}'::jsonb, '2026-03-01T23:35:57.570Z'::timestamptz)
) AS v(action, prev, actor, ts);

INSERT INTO annotation_responses (tenant_id, annotation_id, type, text, created_by, created_at, legacy_id)
SELECT a.tenant_id, a.id, 'approved', '', '{"id": "07d89480-e7e7-11ee-8327-cfc6eea1d65a", "email": "bruno@myio.com.br", "name": "Bruno Dantas"}'::jsonb, '2026-03-01T23:35:57.570Z'::timestamptz, '4e952def-7213-404b-8c74-5fb5f58f2a16'::uuid
FROM annotations a
WHERE a.legacy_id = '45e9d98a-8d70-49e6-a7e6-d763574576cf'::uuid AND a.entity_id = '9eb75b77-c9b8-4ff6-9acb-952f43321e4c'
ON CONFLICT (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING;

COMMIT;

-- =============================================================================
-- Verification (expected on first run: 137 annotations, 65 responses,
-- 208 events; re-runs add 0 everywhere)
-- =============================================================================
SELECT
  (SELECT count(*) FROM annotations  WHERE legacy_id IS NOT NULL
     AND entity_id IN (SELECT id FROM devices WHERE id = ANY(ARRAY[
       'a8c5c842-b9e9-4a2a-95c1-27da217460e9'::uuid,       '2b526f1f-cab8-445b-a27a-15f8054e8424'::uuid,       'cc4a6665-4630-4c7d-a309-3f9a4a78f351'::uuid,       '9a7342dc-83c0-41ad-98b2-2f7c9ffd46f9'::uuid,       'b4e6cf1b-5420-44a6-a75d-ecd7cb7982dd'::uuid,       'e0b18d2c-6418-4c00-adba-41564b82960b'::uuid,       '5e7f1446-89c2-42d1-8059-f72bd405e8a7'::uuid,       'b56d38c1-ee73-4697-8bd2-5be00e21c655'::uuid,       '3364033a-d818-4f4a-89ad-2a11b6bd2fcd'::uuid,       'c18e842a-4b6b-48cb-9254-a7b9c26e54fc'::uuid,       '4842ed4d-bfa9-4f04-ab6b-118af951395e'::uuid,       '348715e0-89c3-456d-8fe9-a009cb45a848'::uuid,       '96326fb4-52bd-4816-8986-e08806e50b8e'::uuid,       'd1cc7168-0d03-4e09-b714-2dfc9b8a3531'::uuid,       'f56e9d67-211d-40b8-b3e8-3fddf5c606d0'::uuid,       '881b4e22-73ca-471b-b1a9-645a68956489'::uuid,       '67c3ed84-9487-4907-945d-90a008557e64'::uuid,       '291a93c9-1f4f-4b13-8394-afe5620847a9'::uuid,       'c28d989a-95a4-4f2b-bea2-4212e82f8e74'::uuid,       'a8c572a5-053d-4856-af9c-ef340afebbfa'::uuid,       'd54ebfad-1966-49ff-a0b7-3ababb1f894f'::uuid,       '5a075f17-f38d-4765-89ae-37a6a4f6eebc'::uuid,       '344dc16b-92c2-4901-94db-e4fd2a507bdd'::uuid,       '22c97f23-5e26-4bf3-95ac-90bbcb024946'::uuid,       '20913d19-06b1-4d32-aa99-07c28bd71e2c'::uuid,       '8afe1fed-1744-470b-bb34-a459835cf2d9'::uuid,       'd36d4003-e0b9-4f52-80a5-790758eea328'::uuid,       'e70e1ccc-3674-411e-b9b7-b1dd2b89746f'::uuid,       '1e13c904-30a3-403a-9345-9a697674a829'::uuid,       '30805708-b5c7-442b-b4c1-d84c4dbb0c68'::uuid,       '0fa47de9-b75b-4572-baea-cc5a452c59f7'::uuid,       'd689a53f-44f0-43b3-9126-307321de5b31'::uuid,       '7e3e6572-3fe0-470d-8b20-87a7da186274'::uuid,       'e84a161a-acbb-4c7c-af8d-274b904fd1a3'::uuid,       '36860c96-b2dd-4bb6-858c-f76cc89ce432'::uuid,       'f6393f95-ddf0-4af3-8b6e-e8414beb7b1d'::uuid,       'dcd383f2-566e-4c0a-9e97-7a3b01f00756'::uuid,       'd5327d13-9879-4415-b802-7d094ce80d1e'::uuid,       'd7f081e9-9447-4afd-919a-19d36bae0d1c'::uuid,       '86c26bd5-3e3c-46c1-aa80-780b6aaf786c'::uuid,       'a6858835-1433-4b83-8277-8ab48d6c1f1c'::uuid,       'f5ba60d1-0eba-42bc-a5d0-36305baa5764'::uuid,       '1f01672c-8f71-4bf9-989c-7ab98220ad12'::uuid,       '12f660cd-957f-4e6a-b7d6-006de541739c'::uuid,       'd15d87ea-ba3c-4c52-aca5-fff3065eec3f'::uuid,       '33af1b5c-f771-46ce-aa30-b7324b04f26b'::uuid,       'ee533328-c0a6-4439-8154-df146a80ab98'::uuid,       '51792575-7c2e-4a3a-922f-2f6454e3fc24'::uuid,       '11fa9356-1063-41ea-970a-b7eee85e21df'::uuid,       'a98cac94-168c-4bda-a329-eabbae2e909f'::uuid,       '945638fd-57a7-4164-88b7-8cc95046933e'::uuid,       'c8dec94d-e1b2-499e-a5f8-873bd595838f'::uuid,       '97e10ac2-d6a1-456f-a930-19504be376ca'::uuid,       '58e94534-e997-4a74-b64f-7d08ee07a744'::uuid,       '8c945215-3483-4ee0-962a-d8ae4e97296a'::uuid,       '452b452c-c872-4a88-9d71-1bee17e7b6d2'::uuid,       '40b42b05-1094-4b56-ab34-4312e83c8f0d'::uuid,       'b6ef42ca-8b39-4cc1-87f2-d5299c27cff8'::uuid,       'a4446b6d-d6b8-4aa1-801f-83a1f2bb6999'::uuid,       'b6bd1f85-85a6-427b-9cc9-43ac5a1a48ea'::uuid,       'd615b0a1-8a2b-4cc4-85b2-2fcca7a8656c'::uuid,       'a2196e14-ef3c-4c39-8e88-ccec1e79a47c'::uuid,       'c85451d9-c36b-4d8a-abe4-761293dd3d80'::uuid,       '0ab1a774-97ec-4766-989a-66f5a47104d1'::uuid,       '855447be-0c73-4370-bf48-e2f9f2b9887c'::uuid,       'e0b1915b-ac3e-4a8f-ac2c-398cdd05d810'::uuid,       '8f47e2f0-fcd3-4c2d-9d63-1e681581609f'::uuid,       '3cf9d20c-fc8a-4fbb-88f4-3bb07a7a6c06'::uuid,       'efb65380-8f66-4dda-915a-a47a6b875085'::uuid,       '3a8966c5-64ce-4164-98cd-a1ee07944d73'::uuid,       '2a8ccea4-5891-455e-a690-622eae78c2be'::uuid,       '0d6fca87-ffc4-4ecd-a1cf-9227748d0263'::uuid,       '957825ad-0083-4ae3-8fc8-a36ed5b035bc'::uuid,       '739ecf16-bc31-41b6-972d-5fed81be0a1d'::uuid,       '1b2ebebd-97a0-4228-af61-55bbc0472d8b'::uuid,       '02e580c9-df28-4d0b-b156-c6fdb359d453'::uuid,       '59600fd2-c57c-4d9d-824e-cd0521c00260'::uuid,       '798db98d-a16a-4fd3-a249-dbecb6087c51'::uuid,       'b389aa3f-8896-4209-9e85-ae0640f5fa55'::uuid,       '3c7fd801-da25-4b3c-888d-ff92a03c9b68'::uuid,       '74a193b0-9031-4d5b-a2e5-91ceda1a664a'::uuid,       '8604db12-c22f-41e6-8c34-82f86038217d'::uuid,       'a3296240-a933-43b1-9ebf-5f7ba5b47028'::uuid,       'e0bc3fb7-dfd2-4f69-b6e6-9e8d6bb30273'::uuid,       'b8abdd64-2690-48f4-86d7-e96aa2e5af66'::uuid,       'c90e0163-8833-4315-80bf-48bd77aefee6'::uuid,       'e46e0faf-3aed-4536-87f3-480d9eef4cd0'::uuid,       '8ae6f555-00ce-41de-9991-e1338b78395c'::uuid,       '72ecb033-51d9-4ec7-9592-097ff4ae1a0a'::uuid,       '4b5e21ad-30fc-48f1-95c1-a98dfcb107ac'::uuid,       '91e5510a-9730-43a5-b8c5-0e22caaa7053'::uuid,       '218a1641-4c37-4abe-8234-5320af8fffdf'::uuid,       'b5e05c54-e890-46d2-b361-e6b21382bd78'::uuid,       'd43d3361-5171-4ec9-97cb-dc4f1a40089e'::uuid,       'bc4cdc3b-2a5a-4b06-95f7-d37bd6748c1d'::uuid,       '6526b1c9-5cce-4e70-bc47-66c624e8d74c'::uuid,       'fe8d3c5e-4d34-4812-9b06-26bda1158d97'::uuid,       'ba8f743b-0dc3-41fb-ad14-80a24a324bd6'::uuid,       'd5b76b97-0ecc-4a0c-bd7d-dcc9e1245f4a'::uuid,       '4f2abda0-e9ca-47c7-b7ca-58bfbefa597e'::uuid,       '7218df55-5cde-4cb6-a476-27211c6e1bf0'::uuid,       '6aa29dcb-a932-4a99-ab03-6fdafb154488'::uuid,       '5b8ed194-3c42-4b3f-b782-f54e74b83996'::uuid,       '95ef4bba-6327-48bf-93df-2454f2a9023e'::uuid,       '6255116e-3c74-40a6-8f86-e69ffdc9e5cd'::uuid,       '07fe84db-75fe-440a-ac15-3a200678c61a'::uuid,       '7b8a732e-5750-4062-98c6-64dd128afc68'::uuid,       'dac44277-ecc7-45f9-824f-4a44dc68627c'::uuid,       'e543219d-c7a7-409d-a670-b5e764a21b61'::uuid,       '9451a8c8-0d9b-48de-b9df-67079ffa3a6b'::uuid,       '9eb75b77-c9b8-4ff6-9acb-952f43321e4c'::uuid
     ]))) AS annotations_loaded,
  (SELECT count(*) FROM annotation_responses ar
     JOIN annotations a ON a.id = ar.annotation_id
    WHERE ar.legacy_id IS NOT NULL AND a.legacy_id IS NOT NULL) AS responses_loaded,
  (SELECT count(*) FROM annotation_events ev
     JOIN annotations a ON a.id = ev.annotation_id
    WHERE a.legacy_id IS NOT NULL) AS events_loaded;
