#!/bin/bash
# Fetch simplified alarm bundle for Shopping Plaza Macaé with version check (304 cache validation)
# Step 1: Fetch without version → get full bundle + capture version
# Step 2: Fetch again with captured version → expect 304 (no changes)
# Step 3: Fetch with fake version → expect 200 (full bundle)
#
# Customer: Shopping Plaza Macaé (8eccc220-f647-11f0-998e-25174baff087)
#           (UUID encontrado em logs/025-logEditAsset.log — dump de resposta da API prod)
#
# Env vars (todas opcionais, com defaults):
#   API_URL      — default: https://gcdr-api.a.myio-bas.com
#   CUSTOMER_ID  — default: UUID do Shopping Plaza Macaé
#   API_KEY      — default: chave genérica de integração
#   CENTRAL_ID   — filtra por central via header X-Central-Id (vazio = todos)

#API_URL="http://localhost:3015"
# Credenciais locais (nao versionadas — .gitignore cobre .env.*)
ENV_FILE="$(dirname "$0")/.env.macae"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

API_URL="${API_URL:-https://gcdr-api.a.myio-bas.com}"
CUSTOMER_ID="${CUSTOMER_ID:-8eccc220-f647-11f0-998e-25174baff087}"
API_KEY="${API_KEY:-gcdr_alarm_integration_key_2026}"
# Deixe vazio para todos os devices do customer
CENTRAL_ID="${CENTRAL_ID:-}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ENDPOINT="${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple"
LOG_FILE="$(dirname "$0")/version-check-$(date +%Y%m%d_%H%M%S).log"

exec > >(tee >(sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE")) 2>&1

echo "=== Bundle Version Check — Shopping Plaza Macaé ==="
echo "Log: $LOG_FILE"
echo "Customer: $CUSTOMER_ID"
echo "Central:  ${CENTRAL_ID:-<todos>}"
echo "API key:  ${API_KEY:0:8}********** (mascarada)"
echo ""

# ─────────────────────────────────────────────────────────────
# Step 1: First request — no version header
# ─────────────────────────────────────────────────────────────
echo "1. First request (sem X-Version-Id)..."

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$ENDPOINT" \
  -H "X-API-Key: ${API_KEY}" \
  ${CENTRAL_ID:+-H "X-Central-Id: ${CENTRAL_ID}"} \
  -H "Accept: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "   Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  if command -v jq &>/dev/null; then
    VERSION_ID=$(echo "$BODY" | jq -r '.data.versionId // .data.meta.version // .data.version // "N/A"')
    RULES_COUNT=$(echo "$BODY" | jq '(.data.meta.rulesCount // .data.rules | length // 0)')
    DEVICES_COUNT=$(echo "$BODY" | jq '(.data.meta.devicesCount // (.data.deviceIndex | length // 0))')
    DEVICE_KEYS=$(echo "$BODY" | jq -r '.data.deviceIndex | keys | join(", ")' 2>/dev/null)
    SKIP_VERSION=$(echo "$BODY" | jq -r '.data.meta.skipVersionCheck // false')
  else
    VERSION_ID=$(echo "$BODY" | grep -o '"version": *"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')
    RULES_COUNT="?"
    DEVICES_COUNT="?"
    DEVICE_KEYS="(install jq for details)"
    SKIP_VERSION="?"
  fi

  echo -e "   ${GREEN}Bundle recebido OK${NC}"
  echo "   Version:          $VERSION_ID"
  echo "   Rules:            $RULES_COUNT"
  echo "   Devices:          $DEVICES_COUNT"
  echo "   skipVersionCheck: $SKIP_VERSION"
  echo "   Device keys:      $DEVICE_KEYS"
  echo "   Payload size:     $(echo "$BODY" | wc -c) bytes"
  echo ""
  echo "   --- meta completo ---"
  echo "$BODY" | jq '.data.meta'
  echo "   ---------------------"
else
  echo -e "   ${RED}Erro na requisição${NC}"
  echo "   Response: $BODY"
  exit 1
fi

echo ""

# ─────────────────────────────────────────────────────────────
# Step 2: Second request — with captured version (expect 304)
# ─────────────────────────────────────────────────────────────
echo "2. Second request (X-Version-Id: $VERSION_ID)..."

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$ENDPOINT" \
  -H "X-API-Key: ${API_KEY}" \
  ${CENTRAL_ID:+-H "X-Central-Id: ${CENTRAL_ID}"} \
  -H "X-Version-Id: ${VERSION_ID}" \
  -H "Accept: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "   Status: $HTTP_CODE"

# Nota: /bundle/simple NUNCA responde HTTP 304 — cache HIT vem como
# 200 com corpo curto {versionId, message: "Not Modified"} (rules.controller.ts).
if [ "$HTTP_CODE" = "304" ]; then
  echo -e "   ${GREEN}✓ Cache HIT — 304 (bundle não mudou)${NC}"
elif [ "$HTTP_CODE" = "200" ] && echo "$BODY" | grep -q '"message" *: *"Not Modified"'; then
  echo -e "   ${GREEN}✓ Cache HIT — 200 curto {versionId, message: Not Modified} (contrato do /bundle/simple)${NC}"
elif [ "$HTTP_CODE" = "200" ]; then
  echo -e "   ${YELLOW}⚠ Cache MISS — bundle mudou (ou VERSION_ID vazio — instale jq)${NC}"
  if command -v jq &>/dev/null; then
    NEW_VERSION=$(echo "$BODY" | jq -r '.data.versionId // .data.meta.version // empty')
    echo "   Nova version: $NEW_VERSION"
  fi
else
  echo -e "   ${RED}Erro inesperado${NC}"
  echo "   Response: $BODY"
fi

echo ""

# ─────────────────────────────────────────────────────────────
# Step 3: Third request — with wrong version (expect 200)
# ─────────────────────────────────────────────────────────────
echo "3. Third request (X-Version-Id: v0-fake)..."

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "$ENDPOINT" \
  -H "X-API-Key: ${API_KEY}" \
  ${CENTRAL_ID:+-H "X-Central-Id: ${CENTRAL_ID}"} \
  -H "X-Version-Id: v0-fake" \
  -H "Accept: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "   Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "   ${GREEN}✓ Bundle completo retornado (version mismatch esperado)${NC}"
  echo "   Payload size: $(echo "$BODY" | wc -c) bytes"
elif [ "$HTTP_CODE" = "304" ]; then
  echo -e "   ${RED}✗ 304 inesperado com version falsa${NC}"
fi

echo ""
echo "=== Done ==="
echo "Log salvo em: $LOG_FILE"
