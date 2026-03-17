#!/bin/bash
# Cria usuários João e Maria, grupo Manutenção Escadas Rolantes,
# configura canais e dispatch — Mestre Álvaro
#
# Obs: usa psql para INSERT direto (UUIDs fixos para idempotência)
# Substitua PGHOST / PGDATABASE / PGUSER conforme seu ambiente

BASE_URL="${GCDR_URL:-http://localhost:3015}"
TOKEN="${GCDR_TOKEN:-}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
GROUP_ID="eeee0001-0001-0001-0001-000000000010"
JOAO_ID="eeee0001-0001-0001-0001-000000000001"
MARIA_ID="eeee0001-0001-0001-0001-000000000002"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"

AUTH_HEADER="Authorization: Bearer ${TOKEN}"
TENANT_HEADER="X-Tenant-Id: ${TENANT_ID}"

echo "====================================================="
echo " Setup — Manutenção Escadas Rolantes / Mestre Álvaro"
echo "====================================================="

# ------------------------------------------------------------------
# SQL: criar usuários + contacts + grupo + customer_channels
# (execute via psql ou ferramenta de banco — ver comentários no SQL)
# ------------------------------------------------------------------
cat <<'SQL'
-- ================================================================
-- 1. Usuários
-- ================================================================
INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, active_sessions, tags, metadata, version)
VALUES
  ('eeee0001-0001-0001-0001-000000000001','11111111-1111-1111-1111-111111111111','e04046d4-baa4-44e9-a378-4dfebe4140f1',
   'joao@mestrealvaro.com.br', true, 'joao.silva', 'CUSTOMER', 'ACTIVE',
   '{"firstName":"João","lastName":"Silva","displayName":"João Silva"}'::jsonb,
   '{}'::jsonb,'{"locale":"pt-BR","timezone":"America/Sao_Paulo"}'::jsonb,
   0,'["manutencao"]'::jsonb,'{}'::jsonb, 1),
  ('eeee0001-0001-0001-0001-000000000002','11111111-1111-1111-1111-111111111111','e04046d4-baa4-44e9-a378-4dfebe4140f1',
   'maria@mestrealvaro.com.br', true, 'maria.souza', 'CUSTOMER', 'ACTIVE',
   '{"firstName":"Maria","lastName":"Souza","displayName":"Maria Souza"}'::jsonb,
   '{}'::jsonb,'{"locale":"pt-BR","timezone":"America/Sao_Paulo"}'::jsonb,
   0,'["manutencao"]'::jsonb,'{}'::jsonb, 1)
ON CONFLICT (tenant_id, email) DO NOTHING;

-- ================================================================
-- 2. Contacts (email + telegram de cada um)
-- ================================================================
INSERT INTO user_contacts (id, tenant_id, user_id, channel, value, label, verified, active)
VALUES
  (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','eeee0001-0001-0001-0001-000000000001','EMAIL',   'joao@mestrealvaro.com.br','Email João',   true,true),
  (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','eeee0001-0001-0001-0001-000000000001','TELEGRAM','@joaosilva',              'Telegram João',true,true),
  (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','eeee0001-0001-0001-0001-000000000002','EMAIL',   'maria@mestrealvaro.com.br','Email Maria', true,true),
  (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','eeee0001-0001-0001-0001-000000000002','TELEGRAM','@mariasouza',             'Telegram Maria',true,true)
ON CONFLICT (tenant_id, user_id, channel, value) DO NOTHING;

-- ================================================================
-- 3. Grupo
-- ================================================================
INSERT INTO groups (id, tenant_id, customer_id, name, display_name, description, code, type, purposes, members, member_count, tags, metadata, visible_to_child_customers, editable_by_child_customers, status, version)
VALUES (
  'eeee0001-0001-0001-0001-000000000010',
  '11111111-1111-1111-1111-111111111111',
  'e04046d4-baa4-44e9-a378-4dfebe4140f1',
  'Manutenção Escadas Rolantes','Manutenção Escadas Rolantes',
  'Grupo responsável por alarmes de escadas rolantes',
  'MANUT-ESCADAS','USER','["ALARMS_NOTIFY"]'::jsonb,
  '[
    {"id":"eeee0001-0001-0001-0001-000000000001","type":"USER","name":"João Silva","addedAt":"2026-03-16T00:00:00Z"},
    {"id":"eeee0001-0001-0001-0001-000000000002","type":"USER","name":"Maria Souza","addedAt":"2026-03-16T00:00:00Z"}
  ]'::jsonb,
  2,'["manutencao","escadas-rolantes"]'::jsonb,'{}'::jsonb,
  false,false,'ACTIVE',1
) ON CONFLICT DO NOTHING;

-- ================================================================
-- 4. Customer channels (credenciais) — EMAIL + TELEGRAM
-- ================================================================
INSERT INTO customer_channels (id, tenant_id, customer_id, channel, active, config)
VALUES
  (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','e04046d4-baa4-44e9-a378-4dfebe4140f1',
   'EMAIL', true, '{"host":"smtp.mestrealvaro.com.br","port":"587","secure":"false","user":"alarmes@mestrealvaro.com.br","pass":"SENHA","from":"Alarmes Mestre Álvaro <alarmes@mestrealvaro.com.br>"}'::jsonb),
  (gen_random_uuid(),'11111111-1111-1111-1111-111111111111','e04046d4-baa4-44e9-a378-4dfebe4140f1',
   'TELEGRAM', true, '{"botToken":"BOT_TOKEN_AQUI"}'::jsonb)
ON CONFLICT (tenant_id, customer_id, channel) DO NOTHING;

-- Verificação
SELECT 'users'    AS t, count(*) FROM users            WHERE id IN ('eeee0001-0001-0001-0001-000000000001','eeee0001-0001-0001-0001-000000000002')
UNION ALL
SELECT 'contacts',       count(*) FROM user_contacts   WHERE user_id IN ('eeee0001-0001-0001-0001-000000000001','eeee0001-0001-0001-0001-000000000002')
UNION ALL
SELECT 'group',          count(*) FROM groups           WHERE id = 'eeee0001-0001-0001-0001-000000000010'
UNION ALL
SELECT 'cust_channels',  count(*) FROM customer_channels WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND channel IN ('EMAIL','TELEGRAM');
-- Esperado: 2 | 4 | 1 | 2
SQL

# ------------------------------------------------------------------
# API: configurar group_channels (targets) via REST
# ------------------------------------------------------------------
echo ""
echo "[API] PUT /groups/${GROUP_ID}/channels"
curl -s -X PUT \
  "${BASE_URL}/api/v1/groups/${GROUP_ID}/channels" \
  -H "${AUTH_HEADER}" \
  -H "${TENANT_HEADER}" \
  -H "Content-Type: application/json" \
  -d '{
    "channels": [
      { "channel": "TELEGRAM", "active": true, "target": "-100123456789" },
      { "channel": "EMAIL",    "active": true, "target": "manut-escadas@mestrealvaro.com.br" }
    ]
  }' | jq '{channels: [.data.items[] | {channel, target, active}]}'

# ------------------------------------------------------------------
# API: configurar dispatch matrix via REST
# ------------------------------------------------------------------
echo ""
echo "[API] PUT /groups/${GROUP_ID}/dispatch"
curl -s -X PUT \
  "${BASE_URL}/api/v1/groups/${GROUP_ID}/dispatch" \
  -H "${AUTH_HEADER}" \
  -H "${TENANT_HEADER}" \
  -H "Content-Type: application/json" \
  -d '{
    "entries": [
      { "channel": "EMAIL",    "action": "OPEN",     "active": true,  "escalationDelayMs": 0    },
      { "channel": "EMAIL",    "action": "CLOSE",    "active": true,  "escalationDelayMs": 0    },
      { "channel": "TELEGRAM", "action": "OPEN",     "active": true,  "escalationDelayMs": 0    },
      { "channel": "TELEGRAM", "action": "CLOSE",    "active": true,  "escalationDelayMs": 0    },
      { "channel": "TELEGRAM", "action": "ESCALATE", "active": true,  "escalationDelayMs": 5000 }
    ]
  }' | jq '{matrix: [.data.items[] | {channel, action, active, escalationDelayMs}]}'

echo ""
echo "====================================================="
echo " Pronto. Grupo configurado:"
echo "  Canais:   TELEGRAM (-100123456789) | EMAIL (alias)"
echo "  Dispatch: OPEN + CLOSE em ambos, ESCALATE no Telegram após 5s"
echo "====================================================="
