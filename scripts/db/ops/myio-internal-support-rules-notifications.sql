-- =============================================================================
-- OPS: Myio — Vincular Grupo de Notificação nas Internal Support Rules
-- =============================================================================
-- Tenant  : 11111111-1111-1111-1111-111111111111
-- Customer: 56614a70-326f-11ef-ad2c-53aeabe7d3fa (Myio)
-- Grupo   : 945acbfb-9b96-4073-9555-c0f61a4860be (Grupo Interno MYIO Alarmes)
--
-- Rules:
--   407b48fe  Caixa d'Água — Sem Leitura 12h
--   091563a1  Dispositivos de Água — Sem Leitura 12h
--   cc404f82  Dispositivos de Energia — Sem Leitura 12h
--   3f9d29a0  Dispositivos de Temperatura — Sem Leitura 12h
--
-- Customers monitorados (scope):
--   Mestre Álvaro        e04046d4-baa4-44e9-a378-4dfebe4140f1
--   Mont Serrat          a4c64215-f7eb-4102-80b5-e10b98e2f94e
--   Moxuara              84e0370e-636a-4741-9874-504b5e0b3577
--   Rio Poty             8f9af056-10c2-4cd4-a45f-ab0c99377aca
--   Shopping da Ilha     f1fcf434-532b-428a-a5e1-0b68e8ae1056
--   Metrópole Ananindeua c4030d78-1cf4-4bf6-8eed-c12b4e7c281a
-- =============================================================================

UPDATE rules
SET
  notifications = jsonb_build_object(
    'OPEN', jsonb_build_object(
      'enabled',    true,
      'recipients', jsonb_build_array(
        jsonb_build_object(
          'sourceType', 'GROUP',
          'groupId',    '945acbfb-9b96-4073-9555-c0f61a4860be',
          'name',       'Grupo Interno MYIO Alarmes'
        )
      )
    ),
    'CLOSE', jsonb_build_object(
      'enabled',    true,
      'recipients', jsonb_build_array(
        jsonb_build_object(
          'sourceType', 'GROUP',
          'groupId',    '945acbfb-9b96-4073-9555-c0f61a4860be',
          'name',       'Grupo Interno MYIO Alarmes'
        )
      )
    ),
    'ESCALATE', jsonb_build_object(
      'enabled',    true,
      'recipients', jsonb_build_array(
        jsonb_build_object(
          'sourceType', 'GROUP',
          'groupId',    '945acbfb-9b96-4073-9555-c0f61a4860be',
          'name',       'Grupo Interno MYIO Alarmes'
        )
      )
    )
  ),
  updated_at = now(),
  version    = version + 1
WHERE id IN (
  '407b48fe-0074-4d32-9f96-22da848e511b',  -- Caixa d'Água — Sem Leitura 12h
  '091563a1-19a6-4004-bfd9-65fa348b7394',  -- Dispositivos de Água — Sem Leitura 12h
  'cc404f82-1d03-40a7-a1ca-8989ddea4749',  -- Dispositivos de Energia — Sem Leitura 12h
  '3f9d29a0-b293-4da9-83e4-0e2bc38566c7'   -- Dispositivos de Temperatura — Sem Leitura 12h
);

-- Verify
SELECT
  id,
  name,
  notifications->'OPEN'->'recipients'->0->>'sourceType'  AS recipient_type,
  notifications->'OPEN'->'recipients'->0->>'groupId'     AS group_id,
  notifications->'OPEN'->>'enabled'                      AS open_enabled,
  notifications->'CLOSE'->>'enabled'                     AS close_enabled,
  notifications->'ESCALATE'->>'enabled'                  AS escalate_enabled
FROM rules
WHERE id IN (
  '407b48fe-0074-4d32-9f96-22da848e511b',
  '091563a1-19a6-4004-bfd9-65fa348b7394',
  'cc404f82-1d03-40a7-a1ca-8989ddea4749',
  '3f9d29a0-b293-4da9-83e4-0e2bc38566c7'
)
ORDER BY name;
