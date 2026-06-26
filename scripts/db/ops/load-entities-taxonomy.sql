-- =============================================================================
-- LOAD: Entity Registry — energy + water taxonomy (system defaults) · LOCAL DB
-- =============================================================================
-- Wipes `entities` and loads the energy & water GROUP/PROFILE trees as
-- system-default taxonomy (customer_id NULL, is_system = true). Canonical dev
-- tenant. Re-running is safe: it truncates and reloads the whole taxonomy.
--
--   energy (GROUP)
--   ├── energy-entry        → PROFILE: ENTRADA, RELOGIO, SUBESTACAO, TRAFO_ENTRADA
--   ├── energy-commonarea
--   │   ├── climatizacao    → PROFILE: CHILLER, FANCOIL, BOMBA
--   │   ├── elevadores      → PROFILE: ELEVADOR
--   │   ├── escada-rolante  → PROFILE: ESCADA_ROLANTE
--   │   └── outros-equipamentos → PROFILE: MOTOR, BOMBA_HIDRAULICA, BOMBA_INCENDIO
--   └── energy-stores       → PROFILE: 3F_MEDIDOR
--
--   water (GROUP)
--   ├── water-entry         → PROFILE: HIDROMETRO_ENTRADA, HIDROMETRO_SHOPPING
--   ├── water-commonarea    → PROFILE: BANHEIROS, HIDROMETRO_ADMINISTRACAO
--   └── water-stores        → PROFILE: HIDROMETRO
--
--   temperature (GROUP)
--   ├── temperature-internal  (GROUP, no profiles yet)
--   └── temperature-external  (GROUP, no profiles yet)
--
-- Run (local): docker exec -i gcdr-db-local psql -U postgres -d db_gcdr \
--                < scripts/db/ops/load-entities-taxonomy.sql
-- =============================================================================

SET client_encoding TO 'UTF8';

-- The taxonomy nests GROUPs (energy → energy-entry → …), so GROUP must accept a
-- GROUP parent (the registry shipped it root-only). PROFILE hangs under a GROUP.
INSERT INTO entity_types (tenant_id, entity_type, label, description, allowed_parent_types) VALUES
  ('11111111-1111-1111-1111-111111111111', 'GROUP',   'Group',   'Telemetry grouping (nestable).', '{GROUP}'),
  ('11111111-1111-1111-1111-111111111111', 'PROFILE', 'Profile', 'A profile under a group.',       '{GROUP}')
ON CONFLICT (tenant_id, entity_type) DO UPDATE
  SET allowed_parent_types = EXCLUDED.allowed_parent_types;

-- Clean. TRUNCATE bypasses the is_system BEFORE-DELETE trigger (SYSTEM_PROTECTED)
-- and the self-referencing FK — a plain DELETE would be blocked / order-sensitive.
TRUNCATE TABLE entities;

-- ----------------------------------------------------------------------------
-- ENERGY
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_tenant UUID := '11111111-1111-1111-1111-111111111111';
    v_actor  UUID := '11111111-1111-1111-1111-111111111111';
    g_energy  UUID := gen_random_uuid();
    g_entry   UUID := gen_random_uuid();
    g_common  UUID := gen_random_uuid();
    g_clima   UUID := gen_random_uuid();
    g_elev    UUID := gen_random_uuid();
    g_escada  UUID := gen_random_uuid();
    g_outros  UUID := gen_random_uuid();
    g_stores  UUID := gen_random_uuid();
BEGIN
    -- GROUPs: root + sub-groups
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (g_energy, v_tenant, NULL, 'GROUP', 'energy',              'Energia',             NULL,     10, true, true, v_actor, v_actor),
      (g_entry,  v_tenant, NULL, 'GROUP', 'energy-entry',        'Entrada de Energia',  g_energy, 10, true, true, v_actor, v_actor),
      (g_common, v_tenant, NULL, 'GROUP', 'energy-commonarea',   'Área Comum',          g_energy, 20, true, true, v_actor, v_actor),
      (g_stores, v_tenant, NULL, 'GROUP', 'energy-stores',       'Lojas',               g_energy, 30, true, true, v_actor, v_actor),
      (g_clima,  v_tenant, NULL, 'GROUP', 'climatizacao',        'Climatização',        g_common, 10, true, true, v_actor, v_actor),
      (g_elev,   v_tenant, NULL, 'GROUP', 'elevadores',          'Elevadores',          g_common, 20, true, true, v_actor, v_actor),
      (g_escada, v_tenant, NULL, 'GROUP', 'escada-rolante',      'Escada Rolante',      g_common, 30, true, true, v_actor, v_actor),
      (g_outros, v_tenant, NULL, 'GROUP', 'outros-equipamentos', 'Outros Equipamentos', g_common, 40, true, true, v_actor, v_actor);

    -- PROFILEs under energy-entry
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'ENTRADA',       'Entrada',          g_entry, 10, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'RELOGIO',       'Relógio',          g_entry, 20, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'SUBESTACAO',    'Subestação',       g_entry, 30, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'TRAFO_ENTRADA', 'Trafo de Entrada', g_entry, 40, true, true, v_actor, v_actor);

    -- PROFILEs under climatizacao
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'CHILLER', 'Chiller', g_clima, 10, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'FANCOIL', 'Fancoil', g_clima, 20, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'BOMBA',   'Bomba',   g_clima, 30, true, true, v_actor, v_actor);

    -- PROFILE under elevadores
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'ELEVADOR', 'Elevador', g_elev, 10, true, true, v_actor, v_actor);

    -- PROFILE under escada-rolante
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'ESCADA_ROLANTE', 'Escada Rolante', g_escada, 10, true, true, v_actor, v_actor);

    -- PROFILEs under outros-equipamentos
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'MOTOR',            'Motor',             g_outros, 10, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'BOMBA_HIDRAULICA', 'Bomba Hidráulica',  g_outros, 20, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'BOMBA_INCENDIO',   'Bomba de Incêndio', g_outros, 30, true, true, v_actor, v_actor);

    -- PROFILE under energy-stores
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', '3F_MEDIDOR', 'Medidor 3F', g_stores, 10, true, true, v_actor, v_actor);
END $$;

-- ----------------------------------------------------------------------------
-- WATER
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_tenant UUID := '11111111-1111-1111-1111-111111111111';
    v_actor  UUID := '11111111-1111-1111-1111-111111111111';
    w_water   UUID := gen_random_uuid();
    w_entry   UUID := gen_random_uuid();
    w_common  UUID := gen_random_uuid();
    w_stores  UUID := gen_random_uuid();
BEGIN
    -- GROUPs: root + sub-groups
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (w_water,  v_tenant, NULL, 'GROUP', 'water',             'Água',            NULL,    20, true, true, v_actor, v_actor),
      (w_entry,  v_tenant, NULL, 'GROUP', 'water-entry',       'Entrada de Água', w_water, 10, true, true, v_actor, v_actor),
      (w_common, v_tenant, NULL, 'GROUP', 'water-commonarea',  'Área Comum',      w_water, 20, true, true, v_actor, v_actor),
      (w_stores, v_tenant, NULL, 'GROUP', 'water-stores',      'Lojas',           w_water, 30, true, true, v_actor, v_actor);

    -- PROFILEs under water-entry
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'HIDROMETRO_ENTRADA',  'Hidrômetro de Entrada', w_entry, 10, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'HIDROMETRO_SHOPPING', 'Hidrômetro Shopping',   w_entry, 20, true, true, v_actor, v_actor);

    -- PROFILEs under water-commonarea
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'BANHEIROS',               'Banheiros',               w_common, 10, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'HIDROMETRO_ADMINISTRACAO', 'Hidrômetro Administração', w_common, 20, true, true, v_actor, v_actor);

    -- PROFILE under water-stores
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (gen_random_uuid(), v_tenant, NULL, 'PROFILE', 'HIDROMETRO', 'Hidrômetro', w_stores, 10, true, true, v_actor, v_actor);
END $$;

-- ----------------------------------------------------------------------------
-- TEMPERATURE
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_tenant UUID := '11111111-1111-1111-1111-111111111111';
    v_actor  UUID := '11111111-1111-1111-1111-111111111111';
    t_temp     UUID := gen_random_uuid();
BEGIN
    -- GROUPs: root + sub-groups (no profiles yet — ready to be filled later)
    INSERT INTO entities
      (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
       parent_entity_id, sort_order, is_system, is_active, created_by, updated_by)
    VALUES
      (t_temp, v_tenant, NULL, 'GROUP', 'temperature',          'Temperatura',         NULL,   30, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'GROUP', 'temperature-internal', 'Temperatura Interna', t_temp, 10, true, true, v_actor, v_actor),
      (gen_random_uuid(), v_tenant, NULL, 'GROUP', 'temperature-external', 'Temperatura Externa', t_temp, 20, true, true, v_actor, v_actor);
END $$;
