-- =============================================================================
-- RFC-0024 — Mestre Álvaro: Usuários para notificação de alarmes
--
-- Customer  : Mestre Álvaro  (e04046d4-baa4-44e9-a378-4dfebe4140f1)
-- Tenant    : 11111111-1111-1111-1111-111111111111
-- Grupo alvo: 6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c  (já existe)
--
-- Etapa 1/3 — Criar João e Maria + seus contatos individuais
--
-- UUIDs fixos para idempotência (ON CONFLICT DO NOTHING)
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Usuários
-- ----------------------------------------------------------------------------
INSERT INTO users (
  id, tenant_id, customer_id,
  email, email_verified, username,
  type, status,
  profile, security, preferences,
  active_sessions, tags, metadata, version
)
VALUES
  (
    'eeee0001-0001-0001-0001-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'e04046d4-baa4-44e9-a378-4dfebe4140f1',
    'joao@mestrealvaro.com.br', true, 'joao.silva',
    'CUSTOMER', 'ACTIVE',
    '{"firstName":"João","lastName":"Silva","displayName":"João Silva"}'::jsonb,
    '{}'::jsonb,
    '{"locale":"pt-BR","timezone":"America/Sao_Paulo"}'::jsonb,
    0, '["manutencao"]'::jsonb, '{}'::jsonb, 1
  ),
  (
    'eeee0001-0001-0001-0001-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'e04046d4-baa4-44e9-a378-4dfebe4140f1',
    'maria@mestrealvaro.com.br', true, 'maria.souza',
    'CUSTOMER', 'ACTIVE',
    '{"firstName":"Maria","lastName":"Souza","displayName":"Maria Souza"}'::jsonb,
    '{}'::jsonb,
    '{"locale":"pt-BR","timezone":"America/Sao_Paulo"}'::jsonb,
    0, '["manutencao"]'::jsonb, '{}'::jsonb, 1
  )
ON CONFLICT (tenant_id, email) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Contatos individuais de cada usuário
--    EMAIL  → endereço pessoal (usado pelo orquestrador para envio individual)
--    TELEGRAM → handle do usuário (para DM se necessário)
-- ----------------------------------------------------------------------------
INSERT INTO user_contacts (id, tenant_id, user_id, channel, value, label, verified, active)
VALUES
  -- João
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
   'eeee0001-0001-0001-0001-000000000001',
   'EMAIL', 'joao@mestrealvaro.com.br', 'E-mail João', true, true),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
   'eeee0001-0001-0001-0001-000000000001',
   'TELEGRAM', '@joaosilva', 'Telegram João', true, true),

  -- Maria
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
   'eeee0001-0001-0001-0001-000000000002',
   'EMAIL', 'maria@mestrealvaro.com.br', 'E-mail Maria', true, true),

  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
   'eeee0001-0001-0001-0001-000000000002',
   'TELEGRAM', '@mariasouza', 'Telegram Maria', true, true)

ON CONFLICT (tenant_id, user_id, channel, value) DO NOTHING;

-- Verificação
SELECT
  u.username,
  c.channel,
  c.value
FROM users u
JOIN user_contacts c ON c.user_id = u.id
WHERE u.id IN (
  'eeee0001-0001-0001-0001-000000000001',
  'eeee0001-0001-0001-0001-000000000002'
)
ORDER BY u.username, c.channel;
-- Esperado: 4 linhas (2 usuários × 2 canais)
