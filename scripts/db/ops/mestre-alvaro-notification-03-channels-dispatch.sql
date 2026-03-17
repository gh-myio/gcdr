-- =============================================================================
-- RFC-0024 — Mestre Álvaro: Canais de notificação + dispatch matrix
--
-- Customer  : Mestre Álvaro  (e04046d4-baa4-44e9-a378-4dfebe4140f1)
-- Tenant    : 11111111-1111-1111-1111-111111111111
-- Grupo     : 6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c
--
-- Etapa 3/3 — Configurar:
--   A) customer_channels  → credenciais SMTP e bot Telegram do cliente
--   B) group_channels     → targets de destino do grupo
--   C) group_dispatch_configs → matriz canal × ação
--
-- Arquitetura de entrega:
--   TELEGRAM → GROUP    : uma mensagem para o chat do grupo (-100XXXXXXXXXX)
--   EMAIL    → INDIVIDUAL: o orquestrador lê user_contacts de cada membro
--                          e envia um e-mail separado para cada um
-- =============================================================================

-- ----------------------------------------------------------------------------
-- A) Credenciais do cliente (customer_channels)
--    Substitua os valores sensíveis antes de executar em prod.
-- ----------------------------------------------------------------------------
INSERT INTO customer_channels (id, tenant_id, customer_id, channel, active, config)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    'e04046d4-baa4-44e9-a378-4dfebe4140f1',
    'EMAIL', true,
    '{
      "host":   "smtp.mestrealvaro.com.br",
      "port":   "587",
      "secure": "false",
      "user":   "alarmes@mestrealvaro.com.br",
      "pass":   "SUBSTITUIR_SENHA",
      "from":   "Alarmes Mestre Álvaro <alarmes@mestrealvaro.com.br>"
    }'::jsonb
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    'e04046d4-baa4-44e9-a378-4dfebe4140f1',
    'TELEGRAM', true,
    '{
      "botToken": "SUBSTITUIR_BOT_TOKEN"
    }'::jsonb
  )
ON CONFLICT (tenant_id, customer_id, channel) DO NOTHING;

-- ----------------------------------------------------------------------------
-- B) Targets do grupo (group_channels)
--
--   TELEGRAM → chat_id do grupo de manutenção (modo GROUP: 1 msg para todos)
--   EMAIL    → entrega INDIVIDUAL; target vazio indica ao orquestrador que
--              deve buscar os e-mails em user_contacts de cada membro.
--              O config {"deliveryMode":"INDIVIDUAL"} é a chave para o
--              orquestrador saber o comportamento esperado.
--
--   Substitua -100XXXXXXXXXX pelo chat_id real do grupo Telegram.
-- ----------------------------------------------------------------------------
INSERT INTO group_channels (id, tenant_id, group_id, channel, active, target, config)
VALUES
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c',
    'TELEGRAM', true,
    '-100XXXXXXXXXX',          -- ← substituir pelo chat_id real
    '{"deliveryMode":"GROUP"}' ::jsonb
  ),
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c',
    'EMAIL', true,
    '',                        -- sem alias; orquestrador usa user_contacts
    '{"deliveryMode":"INDIVIDUAL"}' ::jsonb
  )
ON CONFLICT (tenant_id, group_id, channel) DO UPDATE
  SET active    = EXCLUDED.active,
      target    = EXCLUDED.target,
      config    = EXCLUDED.config,
      updated_at = now();

-- ----------------------------------------------------------------------------
-- C) Matriz de dispatch (group_dispatch_configs)
--    canal × ação → active + escalation_delay_ms
--
--   EMAIL:    OPEN e CLOSE  (sem delay — entrega imediata por e-mail)
--   TELEGRAM: OPEN e CLOSE  (sem delay)
--   TELEGRAM: ESCALATE      (5000 ms = 5 s após abertura sem ACK)
-- ----------------------------------------------------------------------------
INSERT INTO group_dispatch_configs (id, tenant_id, group_id, channel, action, active, escalation_delay_ms)
VALUES
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c', 'EMAIL',    'OPEN',     true,  0),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c', 'EMAIL',    'CLOSE',    true,  0),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c', 'TELEGRAM', 'OPEN',     true,  0),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c', 'TELEGRAM', 'CLOSE',    true,  0),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c', 'TELEGRAM', 'ESCALATE', true,  5000)
ON CONFLICT (tenant_id, group_id, channel, action) DO UPDATE
  SET active               = EXCLUDED.active,
      escalation_delay_ms  = EXCLUDED.escalation_delay_ms,
      updated_at           = now();

-- ----------------------------------------------------------------------------
-- Verificação final
-- ----------------------------------------------------------------------------
SELECT 'customer_channels' AS tabela, channel, active
FROM customer_channels
WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
  AND channel IN ('EMAIL','TELEGRAM')

UNION ALL

SELECT 'group_channels', channel, active
FROM group_channels
WHERE group_id = '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c'

UNION ALL

SELECT 'dispatch (' || channel || '×' || action || ')', channel, active
FROM group_dispatch_configs
WHERE group_id = '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c'

ORDER BY 1;
-- Esperado: 2 customer_channels + 2 group_channels + 5 dispatch entries = 9 linhas
