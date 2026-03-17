#!/bin/bash
# Exemplos de uso dos endpoints de group_channels e group_dispatch_configs
#
# Group: Manutenção Escadas Rolantes — Mestre Álvaro
#   group_id:    eeee0001-0001-0001-0001-000000000010
#   customer_id: e04046d4-baa4-44e9-a378-4dfebe4140f1
#
# Pré-requisito: migration 0018 já rodada em prod

BASE_URL="${GCDR_URL:-http://localhost:3015}"
TOKEN="${GCDR_TOKEN:-}"   # JWT Bearer
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
GROUP_ID="eeee0001-0001-0001-0001-000000000010"

AUTH_HEADER="Authorization: Bearer ${TOKEN}"
TENANT_HEADER="X-Tenant-Id: ${TENANT_ID}"

echo "========================================================"
echo " Group Channels & Dispatch — Manutenção Escadas Rolantes"
echo "========================================================"

# --------------------------------------------------------------------------
# 1. PUT /groups/:id/channels — configura targets dos canais do grupo
#    TELEGRAM: chat_id do grupo de manutenção
#    EMAIL:    alias do grupo (ou lista de emails)
# --------------------------------------------------------------------------
echo ""
echo "[1/5] PUT /groups/:id/channels — define targets"
curl -s -X PUT \
  "${BASE_URL}/api/v1/groups/${GROUP_ID}/channels" \
  -H "${AUTH_HEADER}" \
  -H "${TENANT_HEADER}" \
  -H "Content-Type: application/json" \
  -d '{
    "channels": [
      {
        "channel": "TELEGRAM",
        "active":  true,
        "target":  "-100123456789"
      },
      {
        "channel": "EMAIL",
        "active":  true,
        "target":  "manut-escadas@mestrealvaro.com.br"
      }
    ]
  }' | jq '{count: .data.count, channels: [.data.items[] | {channel, active, target}]}'

# --------------------------------------------------------------------------
# 2. GET /groups/:id/channels — lista canais configurados
# --------------------------------------------------------------------------
echo ""
echo "[2/5] GET /groups/:id/channels"
curl -s -X GET \
  "${BASE_URL}/api/v1/groups/${GROUP_ID}/channels" \
  -H "${AUTH_HEADER}" \
  -H "${TENANT_HEADER}" \
  | jq '{count: .data.count, channels: [.data.items[] | {channel, active, target}]}'

# --------------------------------------------------------------------------
# 3. PATCH /groups/:id/channels/TELEGRAM — atualiza target do Telegram
# --------------------------------------------------------------------------
echo ""
echo "[3/5] PATCH /groups/:id/channels/TELEGRAM — trocar chat_id"
curl -s -X PATCH \
  "${BASE_URL}/api/v1/groups/${GROUP_ID}/channels/TELEGRAM" \
  -H "${AUTH_HEADER}" \
  -H "${TENANT_HEADER}" \
  -H "Content-Type: application/json" \
  -d '{
    "target": "-100987654321"
  }' | jq '{channel: .data.channel, target: .data.target}'

# --------------------------------------------------------------------------
# 4. PUT /groups/:id/dispatch — configura matriz channel × action
#    EMAIL:    OPEN e CLOSE (delay 0ms)
#    TELEGRAM: OPEN e CLOSE (delay 0ms), ESCALATE (delay 5000ms = 5s)
# --------------------------------------------------------------------------
echo ""
echo "[4/5] PUT /groups/:id/dispatch — define matriz de ações"
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
  }' | jq '{count: .data.count, matrix: [.data.items[] | {channel, action, active, escalationDelayMs}]}'

# --------------------------------------------------------------------------
# 5. PATCH /groups/:id/dispatch — desativar EMAIL no CLOSE
# --------------------------------------------------------------------------
echo ""
echo "[5/5] PATCH /groups/:id/dispatch — desativar EMAIL × CLOSE"
curl -s -X PATCH \
  "${BASE_URL}/api/v1/groups/${GROUP_ID}/dispatch" \
  -H "${AUTH_HEADER}" \
  -H "${TENANT_HEADER}" \
  -H "Content-Type: application/json" \
  -d '{
    "entries": [
      { "channel": "EMAIL", "action": "CLOSE", "active": false, "escalationDelayMs": 0 }
    ]
  }' | jq '[.data.items[] | {channel, action, active}]'

echo ""
echo "========================================================"
echo " Estado final esperado:"
echo ""
echo "  group_channels:"
echo "    TELEGRAM → -100987654321  (chat_id atualizado em step 3)"
echo "    EMAIL    → manut-escadas@mestrealvaro.com.br"
echo ""
echo "  group_dispatch_configs:"
echo "    EMAIL    × OPEN     active=true  delay=0ms"
echo "    EMAIL    × CLOSE    active=false delay=0ms  (desativado em step 5)"
echo "    TELEGRAM × OPEN     active=true  delay=0ms"
echo "    TELEGRAM × CLOSE    active=true  delay=0ms"
echo "    TELEGRAM × ESCALATE active=true  delay=5000ms"
echo "========================================================"
