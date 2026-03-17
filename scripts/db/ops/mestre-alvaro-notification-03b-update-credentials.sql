-- =============================================================================
-- Mestre Álvaro — atualizar credenciais reais (NÃO COMMITAR)
-- Rodar uma vez em prod após 03-channels-dispatch.sql
-- =============================================================================

-- Bot token do cliente (customer_channels)
UPDATE customer_channels
SET config = '{"botToken": "7251117895:AAFW9YnBopvbibNOgkYVOAAB5f_ozsLXsTQ"}'::jsonb
WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
  AND channel     = 'TELEGRAM';

-- Chat_id do grupo (group_channels)
UPDATE group_channels
SET target = '-5298179834'
WHERE group_id = '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c'
  AND channel  = 'TELEGRAM';

-- Verificação
SELECT 'customer_channels' AS t, channel, active, config->>'botToken' AS bot_token
FROM customer_channels
WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND channel = 'TELEGRAM'
UNION ALL
SELECT 'group_channels', channel, active, target
FROM group_channels
WHERE group_id = '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c' AND channel = 'TELEGRAM';
