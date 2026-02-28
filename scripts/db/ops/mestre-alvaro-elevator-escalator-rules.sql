-- =============================================================================
-- CREATE RULES: Elevadores e Escadas Rolantes - Mestre Álvaro
--
-- Customer  : Mestre Álvaro (e04046d4-baa4-44e9-a378-4dfebe4140f1)
-- Tenant    : 11111111-1111-1111-1111-111111111111
-- Central L2: d3202744-05dd-46d1-af33-495e9a2ecd52
--
-- Rule IDs:
--   cccc0001-0001-0001-0001-000000000001  Elevadores parados (seg-sáb)
--   cccc0001-0001-0001-0001-000000000002  Elevadores parados (domingo)
--   cccc0001-0001-0001-0001-000000000003  Escadas rolantes paradas (seg-sáb)
--   cccc0001-0001-0001-0001-000000000004  Escadas rolantes paradas (domingo)
--
-- Lógica: ALARM_THRESHOLD operator=LT
--   Alerta quando potência instantânea FICA ABAIXO do valor de referência
--   parado por 5 min → equipamento energizado mas sem consumo mínimo esperado.
--
-- Valores de referência por device (RFC-0018 scope_entity_overrides):
--   Elevador 1  slave_id=83   → 512 W
--   Elevador 3  slave_id=87   → 288 W
--   Elevador 4  slave_id=88   → 242 W
--   Elevador 6  slave_id=89   → 228 W
--   Elevador 6  slave_id=84   → 220 W
--   Elevador 7  slave_id=86   → 206 W
--   ER 3        slave_id=92   → 3260 W
--   ER 4        slave_id=93   → 3260 W
--   ER 8        slave_id=130  → 1740 W
--   ER 9        slave_id=131  → 1330 W
-- =============================================================================

DO $$
DECLARE
  v_tenant   uuid := '11111111-1111-1111-1111-111111111111';
  v_customer uuid := 'e04046d4-baa4-44e9-a378-4dfebe4140f1';
  v_central  uuid := 'd3202744-05dd-46d1-af33-495e9a2ecd52';

  -- Elevadores
  v_el1  uuid;  -- slave 83  → 512 W
  v_el3  uuid;  -- slave 87  → 288 W
  v_el4  uuid;  -- slave 88  → 242 W
  v_el6a uuid;  -- slave 89  → 228 W
  v_el6b uuid;  -- slave 84  → 220 W
  v_el7  uuid;  -- slave 86  → 206 W

  -- Escadas Rolantes
  v_er3  uuid;  -- slave 92  → 3260 W
  v_er4  uuid;  -- slave 93  → 3260 W
  v_er8  uuid;  -- slave 130 → 1740 W
  v_er9  uuid;  -- slave 131 → 1330 W

  v_el_ids       uuid[];
  v_er_ids       uuid[];
  v_el_overrides jsonb := '{}';
  v_er_overrides jsonb := '{}';

  -- Configs base (o valor base nunca é usado pois todos têm override;
  -- mantido como fallback documentado)
  v_el_config_ss text := '{"metric":"instantaneous_power","operator":"LT","value":206,"duration":300000,"aggregation":"AVG","startAt":"10:00","endAt":"22:00","daysOfWeek":[1,2,3,4,5,6],"keyMulti":1,"hysteresis":0,"dedup":{"enabled":true,"ttlSeconds":600},"cooldown":{"enabled":true,"seconds":300,"perChannel":false},"hysteresisGuard":{"enabled":false,"windowSeconds":180,"maxTransitions":3},"digest":{"enabled":false,"windowSeconds":600,"threshold":5}}';
  v_el_config_do text := '{"metric":"instantaneous_power","operator":"LT","value":206,"duration":300000,"aggregation":"AVG","startAt":"12:00","endAt":"22:00","daysOfWeek":[0],"keyMulti":1,"hysteresis":0,"dedup":{"enabled":true,"ttlSeconds":600},"cooldown":{"enabled":true,"seconds":300,"perChannel":false},"hysteresisGuard":{"enabled":false,"windowSeconds":180,"maxTransitions":3},"digest":{"enabled":false,"windowSeconds":600,"threshold":5}}';

  v_er_config_ss text := '{"metric":"instantaneous_power","operator":"LT","value":1330,"duration":300000,"aggregation":"AVG","startAt":"10:00","endAt":"22:00","daysOfWeek":[1,2,3,4,5,6],"keyMulti":1,"hysteresis":0,"dedup":{"enabled":true,"ttlSeconds":600},"cooldown":{"enabled":true,"seconds":300,"perChannel":false},"hysteresisGuard":{"enabled":false,"windowSeconds":180,"maxTransitions":3},"digest":{"enabled":false,"windowSeconds":600,"threshold":5}}';
  v_er_config_do text := '{"metric":"instantaneous_power","operator":"LT","value":1330,"duration":300000,"aggregation":"AVG","startAt":"12:00","endAt":"22:00","daysOfWeek":[0],"keyMulti":1,"hysteresis":0,"dedup":{"enabled":true,"ttlSeconds":600},"cooldown":{"enabled":true,"seconds":300,"perChannel":false},"hysteresisGuard":{"enabled":false,"windowSeconds":180,"maxTransitions":3},"digest":{"enabled":false,"windowSeconds":600,"threshold":5}}';

BEGIN

  -- -------------------------------------------------------------------------
  -- STEP 1: Buscar devices por slave_id + central
  -- -------------------------------------------------------------------------
  SELECT id INTO v_el1  FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=83  LIMIT 1;
  SELECT id INTO v_el3  FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=87  LIMIT 1;
  SELECT id INTO v_el4  FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=88  LIMIT 1;
  SELECT id INTO v_el6a FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=89  LIMIT 1;
  SELECT id INTO v_el6b FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=84  LIMIT 1;
  SELECT id INTO v_el7  FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=86  LIMIT 1;

  SELECT id INTO v_er3  FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=92  LIMIT 1;
  SELECT id INTO v_er4  FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=93  LIMIT 1;
  SELECT id INTO v_er8  FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=130 LIMIT 1;
  SELECT id INTO v_er9  FROM devices WHERE tenant_id=v_tenant AND customer_id=v_customer AND central_id=v_central AND slave_id=131 LIMIT 1;

  -- -------------------------------------------------------------------------
  -- STEP 2: Log do resultado da busca
  -- -------------------------------------------------------------------------
  RAISE NOTICE '=== Devices encontrados ===';
  RAISE NOTICE 'Elevador 1  (slave 83 ): %', COALESCE(v_el1::text,  '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'Elevador 3  (slave 87 ): %', COALESCE(v_el3::text,  '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'Elevador 4  (slave 88 ): %', COALESCE(v_el4::text,  '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'Elevador 6a (slave 89 ): %', COALESCE(v_el6a::text, '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'Elevador 6b (slave 84 ): %', COALESCE(v_el6b::text, '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'Elevador 7  (slave 86 ): %', COALESCE(v_el7::text,  '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'ER 3        (slave 92 ): %', COALESCE(v_er3::text,  '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'ER 4        (slave 93 ): %', COALESCE(v_er4::text,  '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'ER 8        (slave 130): %', COALESCE(v_er8::text,  '*** NÃO ENCONTRADO ***');
  RAISE NOTICE 'ER 9        (slave 131): %', COALESCE(v_er9::text,  '*** NÃO ENCONTRADO ***');

  -- -------------------------------------------------------------------------
  -- STEP 3: Montar arrays e overrides
  -- -------------------------------------------------------------------------
  v_el_ids := ARRAY_REMOVE(ARRAY[v_el1, v_el3, v_el4, v_el6a, v_el6b, v_el7], NULL);
  v_er_ids := ARRAY_REMOVE(ARRAY[v_er3, v_er4, v_er8, v_er9], NULL);

  -- Overrides elevadores (valor referência parado por device)
  IF v_el1  IS NOT NULL THEN v_el_overrides := v_el_overrides || jsonb_build_object(v_el1::text,  jsonb_build_object('value', 512));  END IF;
  IF v_el3  IS NOT NULL THEN v_el_overrides := v_el_overrides || jsonb_build_object(v_el3::text,  jsonb_build_object('value', 288));  END IF;
  IF v_el4  IS NOT NULL THEN v_el_overrides := v_el_overrides || jsonb_build_object(v_el4::text,  jsonb_build_object('value', 242));  END IF;
  IF v_el6a IS NOT NULL THEN v_el_overrides := v_el_overrides || jsonb_build_object(v_el6a::text, jsonb_build_object('value', 228));  END IF;
  IF v_el6b IS NOT NULL THEN v_el_overrides := v_el_overrides || jsonb_build_object(v_el6b::text, jsonb_build_object('value', 220));  END IF;
  IF v_el7  IS NOT NULL THEN v_el_overrides := v_el_overrides || jsonb_build_object(v_el7::text,  jsonb_build_object('value', 206));  END IF;

  -- Overrides escadas (valor referência parada por device)
  IF v_er3 IS NOT NULL THEN v_er_overrides := v_er_overrides || jsonb_build_object(v_er3::text, jsonb_build_object('value', 3260)); END IF;
  IF v_er4 IS NOT NULL THEN v_er_overrides := v_er_overrides || jsonb_build_object(v_er4::text, jsonb_build_object('value', 3260)); END IF;
  IF v_er8 IS NOT NULL THEN v_er_overrides := v_er_overrides || jsonb_build_object(v_er8::text, jsonb_build_object('value', 1740)); END IF;
  IF v_er9 IS NOT NULL THEN v_er_overrides := v_er_overrides || jsonb_build_object(v_er9::text, jsonb_build_object('value', 1330)); END IF;

  RAISE NOTICE '=== Montagem ===';
  RAISE NOTICE 'Elevadores: % devices | Overrides: %', array_length(v_el_ids, 1), v_el_overrides;
  RAISE NOTICE 'Escadas:    % devices | Overrides: %', array_length(v_er_ids, 1), v_er_overrides;

  -- -------------------------------------------------------------------------
  -- STEP 4: INSERT rules
  -- -------------------------------------------------------------------------

  -- Rule 1: Elevadores parados (seg-sáb 10:00-22:00)
  INSERT INTO rules (
    id, tenant_id, customer_id,
    name, description, type, priority,
    scope_type, scope_entity_ids, scope_entity_overrides, scope_inherited,
    alarm_config, notification_channels, tags,
    status, enabled, version
  ) VALUES (
    'cccc0001-0001-0001-0001-000000000001',
    v_tenant, v_customer,
    'Potência do Elevador parado em horário de operação (seg-sáb)',
    'Alerta quando a potência instantânea do elevador fica abaixo do valor de referência parado por 5min (seg a sáb 10h-22h) — indica elevador sem energia ou com defeito',
    'ALARM_THRESHOLD', 'MEDIUM', 'DEVICE',
    v_el_ids, v_el_overrides, false,
    v_el_config_ss::jsonb,
    '[]'::jsonb,
    '["elevator","power","parado","mestre-alvaro"]'::jsonb,
    'ACTIVE', true, 1
  ) ON CONFLICT (id) DO UPDATE SET
    scope_entity_ids       = EXCLUDED.scope_entity_ids,
    scope_entity_overrides = EXCLUDED.scope_entity_overrides,
    alarm_config           = EXCLUDED.alarm_config,
    version                = rules.version + 1;

  -- Rule 2: Elevadores parados (domingo 12:00-22:00)
  INSERT INTO rules (
    id, tenant_id, customer_id,
    name, description, type, priority,
    scope_type, scope_entity_ids, scope_entity_overrides, scope_inherited,
    alarm_config, notification_channels, tags,
    status, enabled, version
  ) VALUES (
    'cccc0001-0001-0001-0001-000000000002',
    v_tenant, v_customer,
    'Potência do Elevador parado em horário de operação (domingo)',
    'Alerta quando a potência instantânea do elevador fica abaixo do valor de referência parado por 5min (domingo 12h-22h) — indica elevador sem energia ou com defeito',
    'ALARM_THRESHOLD', 'MEDIUM', 'DEVICE',
    v_el_ids, v_el_overrides, false,
    v_el_config_do::jsonb,
    '[]'::jsonb,
    '["elevator","power","parado","mestre-alvaro"]'::jsonb,
    'ACTIVE', true, 1
  ) ON CONFLICT (id) DO UPDATE SET
    scope_entity_ids       = EXCLUDED.scope_entity_ids,
    scope_entity_overrides = EXCLUDED.scope_entity_overrides,
    alarm_config           = EXCLUDED.alarm_config,
    version                = rules.version + 1;

  -- Rule 3: Escadas Rolantes paradas (seg-sáb 10:00-22:00)
  INSERT INTO rules (
    id, tenant_id, customer_id,
    name, description, type, priority,
    scope_type, scope_entity_ids, scope_entity_overrides, scope_inherited,
    alarm_config, notification_channels, tags,
    status, enabled, version
  ) VALUES (
    'cccc0001-0001-0001-0001-000000000003',
    v_tenant, v_customer,
    'Potência da Escada Rolante parada em horário de operação (seg-sáb)',
    'Alerta quando a potência instantânea da escada rolante fica abaixo do valor de referência parada por 5min (seg a sáb 10h-22h) — indica escada sem energia ou com defeito',
    'ALARM_THRESHOLD', 'MEDIUM', 'DEVICE',
    v_er_ids, v_er_overrides, false,
    v_er_config_ss::jsonb,
    '[]'::jsonb,
    '["escalator","power","parado","mestre-alvaro"]'::jsonb,
    'ACTIVE', true, 1
  ) ON CONFLICT (id) DO UPDATE SET
    scope_entity_ids       = EXCLUDED.scope_entity_ids,
    scope_entity_overrides = EXCLUDED.scope_entity_overrides,
    alarm_config           = EXCLUDED.alarm_config,
    version                = rules.version + 1;

  -- Rule 4: Escadas Rolantes paradas (domingo 12:00-22:00)
  INSERT INTO rules (
    id, tenant_id, customer_id,
    name, description, type, priority,
    scope_type, scope_entity_ids, scope_entity_overrides, scope_inherited,
    alarm_config, notification_channels, tags,
    status, enabled, version
  ) VALUES (
    'cccc0001-0001-0001-0001-000000000004',
    v_tenant, v_customer,
    'Potência da Escada Rolante parada em horário de operação (domingo)',
    'Alerta quando a potência instantânea da escada rolante fica abaixo do valor de referência parada por 5min (domingo 12h-22h) — indica escada sem energia ou com defeito',
    'ALARM_THRESHOLD', 'MEDIUM', 'DEVICE',
    v_er_ids, v_er_overrides, false,
    v_er_config_do::jsonb,
    '[]'::jsonb,
    '["escalator","power","parado","mestre-alvaro"]'::jsonb,
    'ACTIVE', true, 1
  ) ON CONFLICT (id) DO UPDATE SET
    scope_entity_ids       = EXCLUDED.scope_entity_ids,
    scope_entity_overrides = EXCLUDED.scope_entity_overrides,
    alarm_config           = EXCLUDED.alarm_config,
    version                = rules.version + 1;

  RAISE NOTICE '=== Rules criadas/atualizadas com sucesso ===';

END $$;

-- =============================================================================
-- VERIFICAÇÃO
-- =============================================================================
SELECT
  id,
  name,
  array_length(scope_entity_ids, 1)        AS devices_count,
  jsonb_object_keys(scope_entity_overrides) AS override_device_id,
  alarm_config->>'metric'                  AS metric,
  alarm_config->>'operator'                AS op,
  alarm_config->>'value'                   AS base_value_w,
  alarm_config->>'startAt'                 AS start_at,
  alarm_config->>'endAt'                   AS end_at,
  alarm_config->>'daysOfWeek'              AS days,
  status, enabled
FROM rules
WHERE id IN (
  'cccc0001-0001-0001-0001-000000000001',
  'cccc0001-0001-0001-0001-000000000002',
  'cccc0001-0001-0001-0001-000000000003',
  'cccc0001-0001-0001-0001-000000000004'
)
ORDER BY id;
