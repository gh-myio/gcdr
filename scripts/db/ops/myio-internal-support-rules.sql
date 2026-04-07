-- =============================================================================
-- OPS: Myio — Internal Support Rules — Sem Leitura 12h por Domínio
-- =============================================================================
-- Customer : Myio (56614a70-326f-11ef-ad2c-53aeabe7d3fa)
-- Tenant   : 11111111-1111-1111-1111-111111111111
--
-- Rules:
--   1. Água             → metric: water_flow
--   2. Energia          → metric: energy_consumption
--   3. Temperatura      → metric: temperature
--   4. Caixa d'Água     → metric: water_level_continuous
--
-- Flags  : internalRule=true, isInternalSupportRule=true
-- Scope  : GLOBAL (aplica a todos os devices do customer)
-- Schedule: todos os dias, 10:00–22:00
-- Duration: 12h = 43200000ms (sem leitura nesse janela = alarme)
-- =============================================================================

DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := '56614a70-326f-11ef-ad2c-53aeabe7d3fa';

  v_rules JSONB := jsonb_build_array(
    jsonb_build_object(
      'name',        'Dispositivos de Água — Sem Leitura 12h',
      'description', 'Alerta interno de suporte: dispositivos de água sem enviar leitura por 12 horas consecutivas no horário monitorado.',
      'metric',      'water_flow',
      'tags',        '["sem-leitura", "agua", "suporte-interno", "myio"]'
    ),
    jsonb_build_object(
      'name',        'Dispositivos de Energia — Sem Leitura 12h',
      'description', 'Alerta interno de suporte: dispositivos de energia sem enviar leitura por 12 horas consecutivas no horário monitorado.',
      'metric',      'energy_consumption',
      'tags',        '["sem-leitura", "energia", "suporte-interno", "myio"]'
    ),
    jsonb_build_object(
      'name',        'Dispositivos de Temperatura — Sem Leitura 12h',
      'description', 'Alerta interno de suporte: dispositivos de temperatura sem enviar leitura por 12 horas consecutivas no horário monitorado.',
      'metric',      'temperature',
      'tags',        '["sem-leitura", "temperatura", "suporte-interno", "myio"]'
    ),
    jsonb_build_object(
      'name',        'Caixa d''Água — Sem Leitura 12h',
      'description', 'Alerta interno de suporte: dispositivos de nível de caixa d''água sem enviar leitura por 12 horas consecutivas no horário monitorado.',
      'metric',      'water_level_continuous',
      'tags',        '["sem-leitura", "caixa-dagua", "suporte-interno", "myio"]'
    )
  );

  v_rule    JSONB;
  v_rule_id UUID;
BEGIN

  FOR v_rule IN SELECT * FROM jsonb_array_elements(v_rules) LOOP

    -- Guard: evita duplicata por customer + metric
    IF EXISTS (
      SELECT 1 FROM rules
      WHERE tenant_id   = v_tenant_id
        AND customer_id = v_customer_id
        AND type        = 'ALARM_THRESHOLD'
        AND internal_rule = TRUE
        AND is_internal_support_rule = TRUE
        AND alarm_config->>'metric' = v_rule->>'metric'
    ) THEN
      RAISE NOTICE 'Rule já existe para metric % — skipping.', v_rule->>'metric';
      CONTINUE;
    END IF;

    v_rule_id := gen_random_uuid();

    INSERT INTO rules (
      id,
      tenant_id,
      customer_id,
      name,
      description,
      type,
      priority,
      scope_type,
      scope_entity_ids,
      alarm_config,
      notification_channels,
      tags,
      status,
      enabled,
      internal_rule,
      is_internal_support_rule,
      version,
      created_at,
      updated_at
    )
    VALUES (
      v_rule_id,
      v_tenant_id,
      v_customer_id,

      v_rule->>'name',
      v_rule->>'description',

      'ALARM_THRESHOLD',
      'HIGH',

      'GLOBAL',
      ARRAY[]::uuid[],

      jsonb_build_object(
        'metric',           v_rule->>'metric',
        'operator',         'EQ',
        'value',            0,
        'aggregation',      'LAST',
        'duration',         43200000,   -- 12h em ms
        'startAt',          '10:00',
        'endAt',            '22:00',
        'daysOfWeek',       jsonb_build_array(0, 1, 2, 3, 4, 5, 6),

        'cooldown', jsonb_build_object(
          'enabled',    true,
          'seconds',    3600,
          'perChannel', false
        ),
        'dedup', jsonb_build_object(
          'enabled',    true,
          'ttlSeconds', 3600
        )
      ),

      '[]'::jsonb,

      (v_rule->>'tags')::jsonb,

      'ACTIVE',
      TRUE,   -- enabled
      TRUE,   -- internal_rule  → não vai para /bundle/simple
      TRUE,   -- is_internal_support_rule

      1,
      NOW(),
      NOW()
    );

    RAISE NOTICE 'Rule criada: % (metric: %, id: %)', v_rule->>'name', v_rule->>'metric', v_rule_id;

  END LOOP;
END $$;

-- =============================================================================
-- Verify
-- =============================================================================
SELECT
  id,
  name,
  priority,
  scope_type,
  enabled,
  internal_rule,
  is_internal_support_rule,
  alarm_config->>'metric'      AS metric,
  alarm_config->>'aggregation' AS aggregation,
  alarm_config->>'duration'    AS duration_ms,
  alarm_config->>'startAt'     AS start_at,
  alarm_config->>'endAt'       AS end_at
FROM rules
WHERE customer_id = '56614a70-326f-11ef-ad2c-53aeabe7d3fa'
  AND type        = 'ALARM_THRESHOLD'
  AND internal_rule = TRUE
ORDER BY name;


--- results:

4 rows (3ms)
id	name	priority	scope_type	enabled	internal_rule	is_internal_support_rule	metric	aggregation	duration_ms	start_at	end_at
407b48fe-0074-4d32-9f96-22da848e511b	Caixa d'Água — Sem Leitura 12h	HIGH	GLOBAL	true	true	true	water_level_continuous	LAST	43200000	10:00	22:00
091563a1-19a6-4004-bfd9-65fa348b7394	Dispositivos de Água — Sem Leitura 12h	HIGH	GLOBAL	true	true	true	water_flow	LAST	43200000	10:00	22:00
cc404f82-1d03-40a7-a1ca-8989ddea4749	Dispositivos de Energia — Sem Leitura 12h	HIGH	GLOBAL	true	true	true	energy_consumption	LAST	43200000	10:00	22:00
3f9d29a0-b293-4da9-83e4-0e2bc38566c7	Dispositivos de Temperatura — Sem Leitura 12h	HIGH	GLOBAL	true	true	true	temperature	LAST	43200000	10:00	22:00
