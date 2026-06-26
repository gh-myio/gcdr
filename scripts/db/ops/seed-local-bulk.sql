-- =============================================================================
-- SEED LOCAL BULK — dados de teste fartos para o Docker DB (db_gcdr)
-- =============================================================================
-- Tema MYIO: energia/água/IoT para shoppings. Cria, sob um HOLDING dedicado:
--   1 HOLDING + N shoppings (COMPANY), cada um com:
--     • árvore de assets  SITE → BUILDING(2) → FLOOR(3) → ZONE(4)
--     • devices           2 medidores (energia + água) por ZONE
--     • centrals          1 GATEWAY por BUILDING
--     • rules             ALARM_THRESHOLD + SLA + DEVICE_OFFLINE
--     • users             gerente + técnico (@seedmall.local)
--     • work_orders       4 OS
--     • entities          clone da taxonomia de sistema (energy/water/temperature)
--
-- IDEMPOTENTE: limpa o seed anterior (tudo sob o path do HOLDING fixo) antes.
-- Volume: ajuste os arrays (mall_names / bld_names / flr_names / zone_names).
-- Run:  scripts/db/ops/seed-local-bulk.sh   (ou via psql < este arquivo)
-- =============================================================================

SET client_encoding TO 'UTF8';

DO $$
DECLARE
  v_tenant  uuid := '11111111-1111-1111-1111-111111111111';
  v_actor   uuid := '11111111-1111-1111-1111-111111111111';
  v_holding uuid := 'aaaaaaa0-0000-4000-8000-000000000001';
  v_hpath   text;
  mall_names text[] := ARRAY[
    'Shopping Aurora','Shopping Boulevard','Pátio Cristal','Galeria Norte','Vale Verde',
    'Plaza Sul','Mercado Central','Shopping Lumina','Terraço Leste','Shopping Marés',
    'Praça Imperial','Horizonte Mall','Outlet Premium','Shopping Jardins','Center Oeste'];
  bld_names  text[] := ARRAY['Bloco A','Bloco B'];
  flr_names  text[] := ARRAY['Térreo','Piso 1','Piso 2'];
  zone_names text[] := ARRAY['Praça de Alimentação','Estacionamento','Área Técnica','Lojas'];
  wo_types   text[] := ARRAY['INSTALACAO','MANUTENCAO','VISITA_TECNICA','CHAMADO'];
  v_mall uuid; v_mpath text;
  v_site uuid; v_spath text;
  v_bld  uuid; v_bpath text;
  v_flr  uuid; v_fpath text;
  v_zone uuid; v_zpath text;
  v_gw   uuid;
  i int; b int; f int; z int; k int;
  n bigint := 0;  -- contador global p/ codes/serials únicos
BEGIN
  v_hpath := '/'||v_tenant||'/'||v_holding;

  -- ---------------------------------------------------------------- cleanup
  CREATE TEMP TABLE _sc ON COMMIT DROP AS
    SELECT id FROM customers WHERE tenant_id = v_tenant AND path LIKE v_hpath||'%';
  DELETE FROM devices     WHERE customer_id IN (SELECT id FROM _sc);
  DELETE FROM centrals    WHERE customer_id IN (SELECT id FROM _sc);
  DELETE FROM rules       WHERE customer_id IN (SELECT id FROM _sc);
  DELETE FROM work_orders WHERE customer_id IN (SELECT id FROM _sc);
  DELETE FROM assets      WHERE customer_id IN (SELECT id FROM _sc);
  DELETE FROM entities    WHERE customer_id IN (SELECT id FROM _sc);
  DELETE FROM consumption_goal_hours   WHERE goal_id IN (SELECT id FROM consumption_goals WHERE customer_id IN (SELECT id FROM _sc));
  DELETE FROM consumption_goal_history WHERE goal_id IN (SELECT id FROM consumption_goals WHERE customer_id IN (SELECT id FROM _sc));
  DELETE FROM consumption_goals        WHERE customer_id IN (SELECT id FROM _sc);
  DELETE FROM users       WHERE email LIKE '%@seedmall.local';
  DELETE FROM customers   WHERE tenant_id = v_tenant AND path LIKE v_hpath||'%';

  -- ---------------------------------------------------------------- HOLDING
  INSERT INTO customers (id, tenant_id, path, depth, name, display_name, code, type)
  VALUES (v_holding, v_tenant, v_hpath, 0, 'MYIO Holding (seed)', 'MYIO Holding', 'SEED-HOLDING', 'HOLDING');

  -- ---------------------------------------------------------------- malls
  FOR i IN 1..array_length(mall_names,1) LOOP
    v_mall  := gen_random_uuid();
    v_mpath := v_hpath||'/'||v_mall;
    INSERT INTO customers (id, tenant_id, path, depth, name, display_name, code, type)
    VALUES (v_mall, v_tenant, v_mpath, 1, mall_names[i], mall_names[i],
            'SEED-MALL-'||lpad(i::text,3,'0'), 'COMPANY');

    -- clone da taxonomia de sistema sob este customer (parents remapeados)
    INSERT INTO entities (id, tenant_id, customer_id, entity_type, entity_key, entity_value,
                          parent_entity_id, sort_order, is_system, is_active,
                          created_by, updated_by, metadata)
    WITH sys AS (
      SELECT id, parent_entity_id, entity_type, entity_key, entity_value, sort_order, metadata
      FROM entities WHERE tenant_id = v_tenant AND customer_id IS NULL AND is_deleted = false
    ), map AS ( SELECT id AS old_id, gen_random_uuid() AS new_id FROM sys )
    SELECT m.new_id, v_tenant, v_mall, s.entity_type, s.entity_key, s.entity_value,
           pm.new_id, s.sort_order, false, true, v_actor, v_actor, s.metadata
    FROM sys s
    JOIN map m  ON m.old_id  = s.id
    LEFT JOIN map pm ON pm.old_id = s.parent_entity_id;

    -- users
    INSERT INTO users (tenant_id, email) VALUES
      (v_tenant, 'gerente.'||i||'@seedmall.local'),
      (v_tenant, 'tecnico.'||i||'@seedmall.local');

    -- rules (CHECKs exigem *_config não-nulo por tipo; DEVICE_OFFLINE dispensa)
    INSERT INTO rules (tenant_id, customer_id, name, type, alarm_config, sla_config) VALUES
      (v_tenant, v_mall, mall_names[i]||' · Sobrecarga energia', 'ALARM_THRESHOLD',
       '{"metric":"power","operator":">","threshold":1000,"unit":"kW","severity":"MEDIUM"}'::jsonb, NULL),
      (v_tenant, v_mall, mall_names[i]||' · SLA de coleta', 'SLA',
       NULL, '{"maxResponseMinutes":30,"window":"24h"}'::jsonb),
      (v_tenant, v_mall, mall_names[i]||' · Device offline', 'DEVICE_OFFLINE',
       NULL, NULL);

    -- work orders
    FOR k IN 1..4 LOOP
      n := n+1;
      INSERT INTO work_orders (tenant_id, customer_id, type, code, created_by)
      VALUES (v_tenant, v_mall, wo_types[1+((k-1) % array_length(wo_types,1))],
              'WO-'||lpad(i::text,3,'0')||'-'||k, v_actor);
    END LOOP;

    -- SITE
    v_site := gen_random_uuid(); v_spath := '/'||v_mall||'/'||v_site; n := n+1;
    INSERT INTO assets (id, tenant_id, customer_id, path, depth, name, display_name, code, type)
    VALUES (v_site, v_tenant, v_mall, v_spath, 0, mall_names[i]||' · Sede',
            mall_names[i]||' Sede', 'SITE-'||lpad(n::text,5,'0'), 'SITE');

    FOR b IN 1..array_length(bld_names,1) LOOP
      v_bld := gen_random_uuid(); v_bpath := v_spath||'/'||v_bld; n := n+1;
      INSERT INTO assets (id, tenant_id, customer_id, path, depth, name, display_name, code, type)
      VALUES (v_bld, v_tenant, v_mall, v_bpath, 1, bld_names[b], bld_names[b],
              'BLD-'||lpad(n::text,5,'0'), 'BUILDING');

      -- 1 gateway por building
      v_gw := gen_random_uuid(); n := n+1;
      INSERT INTO centrals (id, tenant_id, customer_id, asset_id, name, display_name,
                            serial_number, type, firmware_version, software_version)
      VALUES (v_gw, v_tenant, v_mall, v_bld, 'GW '||bld_names[b], 'Gateway '||bld_names[b],
              'GW-'||lpad(n::text,6,'0'), 'GATEWAY', '1.4.2', '2.1.0');

      FOR f IN 1..array_length(flr_names,1) LOOP
        v_flr := gen_random_uuid(); v_fpath := v_bpath||'/'||v_flr; n := n+1;
        INSERT INTO assets (id, tenant_id, customer_id, path, depth, name, display_name, code, type)
        VALUES (v_flr, v_tenant, v_mall, v_fpath, 2, flr_names[f], flr_names[f],
                'FLR-'||lpad(n::text,5,'0'), 'FLOOR');

        FOR z IN 1..array_length(zone_names,1) LOOP
          v_zone := gen_random_uuid(); v_zpath := v_fpath||'/'||v_zone; n := n+1;
          INSERT INTO assets (id, tenant_id, customer_id, path, depth, name, display_name, code, type)
          VALUES (v_zone, v_tenant, v_mall, v_zpath, 3, zone_names[z], zone_names[z],
                  'ZON-'||lpad(n::text,5,'0'), 'ZONE');

          -- 2 medidores por zona (energia + água)
          -- name é único por (tenant, customer) → sufixo com o contador global
          n := n+1;
          INSERT INTO devices (tenant_id, customer_id, asset_id, name, display_name, type, serial_number)
          VALUES (v_tenant, v_mall, v_zone, 'Medidor Energia · '||zone_names[z]||' #'||n,
                  'Energia '||zone_names[z], 'METER', 'EN-'||lpad(n::text,6,'0'));
          n := n+1;
          INSERT INTO devices (tenant_id, customer_id, asset_id, name, display_name, type, serial_number)
          VALUES (v_tenant, v_mall, v_zone, 'Medidor Água · '||zone_names[z]||' #'||n,
                  'Água '||zone_names[z], 'METER', 'WT-'||lpad(n::text,6,'0'));
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  -- -------------------------------------------------- consumption goals + série horária (RFC-0046)
  -- domains são UPPERCASE e PK (tenant, domain) — garante existência sem duplicar
  INSERT INTO consumption_goal_domains (tenant_id, domain, aggregation_method, unit) VALUES
    (v_tenant, 'ENERGY', 'SUM', 'kWh'),
    (v_tenant, 'WATER',  'SUM', 'm3')
  ON CONFLICT (tenant_id, domain) DO NOTHING;

  -- 1 goal ENERGY + 1 WATER por shopping (ano 2026); unique (tenant,customer,domain,year)
  INSERT INTO consumption_goals (tenant_id, customer_id, domain, year, unit, created_by, updated_by)
  SELECT v_tenant, c.id, dom.domain, 2026, dom.unit, v_actor, v_actor
  FROM customers c
  CROSS JOIN (VALUES ('ENERGY','kWh'), ('WATER','m3'), ('TEMPERATURE','C')) AS dom(domain, unit)
  WHERE c.tenant_id = v_tenant AND c.path LIKE v_hpath||'/%' AND c.depth = 1;

  -- série horária: ano cheio (12 meses × 28 dias × 24h) com curva comercial
  -- (pico ~14h, vale 7h/21h) + variação sazonal por mês + ruído ±10%.
  INSERT INTO consumption_goal_hours (goal_id, month, day, hour, value, source_level, derived, updated_by)
  SELECT g.id, mm.m, dd.d, hh.h,
         CASE g.domain
           -- ENERGY/WATER = consumo (SUM): curva comercial escalada
           WHEN 'ENERGY' THEN round(((30 + 220 * calc.hf) * calc.mf * calc.jit)::numeric, 2)
           WHEN 'WATER'  THEN round((( 2 +  18 * calc.hf) * calc.mf * calc.jit)::numeric, 3)
           -- TEMPERATURE = média (AVERAGE, °C): curva térmica (frio ~3h, pico ~15h) ~14–30°C
           ELSE round((22 + 7 * cos((hh.h - 15) * pi() / 12) + (calc.jit - 1.0) * 10)::numeric, 1)
         END,
         'HOUR', false, v_actor
  FROM consumption_goals g
  CROSS JOIN generate_series(1, 12) AS mm(m)
  CROSS JOIN generate_series(1, 28) AS dd(d)
  CROSS JOIN generate_series(0, 23) AS hh(h)
  CROSS JOIN LATERAL (SELECT
        greatest(0, sin((hh.h - 7) * pi() / 14)) AS hf,   -- curva diária (0 às 7h/21h, pico ~14h)
        0.85 + 0.30 * abs(sin(mm.m * pi() / 12))  AS mf,   -- sazonalidade por mês
        0.90 + random() * 0.20                     AS jit  -- ruído ±10%
      ) AS calc
  WHERE g.customer_id IN (
    SELECT id FROM customers WHERE tenant_id = v_tenant AND path LIKE v_hpath||'/%' AND depth = 1
  );

  RAISE NOTICE 'seed-local-bulk: % shoppings + goals/horas criados sob o holding %', array_length(mall_names,1), v_holding;
END $$;
