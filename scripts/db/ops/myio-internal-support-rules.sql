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
-- Scope  : CUSTOMER — aplica-se aos 6 customers monitorados pela Myio
-- Schedule: todos os dias, 10:00–22:00
-- Duration: 12h = 43200000ms (sem leitura nessa janela = alarme)
--
-- Customers monitorados:
--   Mestre Álvaro        e04046d4-baa4-44e9-a378-4dfebe4140f1
--   Mont Serrat          a4c64215-f7eb-4102-80b5-e10b98e2f94e
--   Moxuara              84e0370e-636a-4741-9874-504b5e0b3577
--   Rio Poty             8f9af056-10c2-4cd4-a45f-ab0c99377aca
--   Shopping da Ilha     f1fcf434-532b-428a-a5e1-0b68e8ae1056
--   Metrópole Ananindeua c4030d78-1cf4-4bf6-8eed-c12b4e7c281a
-- =============================================================================

DO $$
DECLARE
  v_tenant_id    UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id  UUID := '56614a70-326f-11ef-ad2c-53aeabe7d3fa';

  v_scope_ids    UUID[] := ARRAY[
    'e04046d4-baa4-44e9-a378-4dfebe4140f1'::uuid,  -- Mestre Álvaro
    'a4c64215-f7eb-4102-80b5-e10b98e2f94e'::uuid,  -- Mont Serrat
    '84e0370e-636a-4741-9874-504b5e0b3577'::uuid,  -- Moxuara
    '8f9af056-10c2-4cd4-a45f-ab0c99377aca'::uuid,  -- Rio Poty
    'f1fcf434-532b-428a-a5e1-0b68e8ae1056'::uuid,  -- Shopping da Ilha
    'c4030d78-1cf4-4bf6-8eed-c12b4e7c281a'::uuid   -- Metrópole Ananindeua
  ];

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
      WHERE tenant_id              = v_tenant_id
        AND customer_id            = v_customer_id
        AND type                   = 'ALARM_THRESHOLD'
        AND internal_rule          = TRUE
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

      'CUSTOMER',
      v_scope_ids,

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
-- UPDATE: corrige scope nas rules já existentes em prod
-- =============================================================================

UPDATE rules
SET
  scope_type       = 'CUSTOMER',
  scope_entity_ids = ARRAY[
    'e04046d4-baa4-44e9-a378-4dfebe4140f1'::uuid,  -- Mestre Álvaro
    'a4c64215-f7eb-4102-80b5-e10b98e2f94e'::uuid,  -- Mont Serrat
    '84e0370e-636a-4741-9874-504b5e0b3577'::uuid,  -- Moxuara
    '8f9af056-10c2-4cd4-a45f-ab0c99377aca'::uuid,  -- Rio Poty
    'f1fcf434-532b-428a-a5e1-0b68e8ae1056'::uuid,  -- Shopping da Ilha
    'c4030d78-1cf4-4bf6-8eed-c12b4e7c281a'::uuid   -- Metrópole Ananindeua
  ],
  updated_at = now(),
  version    = version + 1
WHERE id IN (
  '407b48fe-0074-4d32-9f96-22da848e511b',  -- Caixa d'Água — Sem Leitura 12h
  '091563a1-19a6-4004-bfd9-65fa348b7394',  -- Dispositivos de Água — Sem Leitura 12h
  'cc404f82-1d03-40a7-a1ca-8989ddea4749',  -- Dispositivos de Energia — Sem Leitura 12h
  '3f9d29a0-b293-4da9-83e4-0e2bc38566c7'   -- Dispositivos de Temperatura — Sem Leitura 12h
);

-- =============================================================================
-- Verify
-- =============================================================================
SELECT
  id,
  name,
  scope_type,
  array_length(scope_entity_ids, 1)    AS scope_customer_count,
  internal_rule,
  is_internal_support_rule,
  alarm_config->>'metric'              AS metric,
  alarm_config->>'startAt'            AS start_at,
  alarm_config->>'endAt'              AS end_at
FROM rules
WHERE customer_id = '56614a70-326f-11ef-ad2c-53aeabe7d3fa'
  AND type        = 'ALARM_THRESHOLD'
  AND internal_rule = TRUE
ORDER BY name;
