#!/bin/bash
# Fetch simplified alarm bundle — Supervia MARACANÃ — version check (304 cache validation)
# Step 1: Fetch without version → get full bundle + capture version
# Step 2: Fetch again with captured version → expect 304 (no changes)
# Step 3: Fetch with fake version → expect 200 (full bundle)

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="46260fbb-89b6-4166-b81e-7bca0b0dc78e"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID="e7a55720-838f-11f0-a06d-e9509531b1d5"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ENDPOINT="${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple"
LOG_FILE="$(dirname "$0")/version-check-$(date +%Y%m%d_%H%M%S).log"

exec > >(tee >(sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE")) 2>&1

echo "=== Bundle Version Check — Supervia MARACANÃ ==="
echo "Log: $LOG_FILE"
echo "Customer: $CUSTOMER_ID"
echo "Central:  ${CENTRAL_ID:-<todos>}"
echo ""

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
    VERSION_ID=$(echo "$BODY" | jq -r '.data.meta.version // .data.version // "N/A"')
    RULES_COUNT=$(echo "$BODY" | jq '(.data.meta.rulesCount // .data.rules | length // 0)')
    DEVICES_COUNT=$(echo "$BODY" | jq '(.data.meta.devicesCount // (.data.deviceIndex | length // 0))')
    DEVICE_KEYS=$(echo "$BODY" | jq -r '.data.deviceIndex | keys | join(", ")' 2>/dev/null)
    SKIP_VERSION=$(echo "$BODY" | jq -r '.data.meta.skipVersionCheck // false')
  else
    VERSION_ID=$(echo "$BODY" | grep -o '"version": *"[^"]*"' | head -1 | grep -o '"[^"]*"$' | tr -d '"')
    RULES_COUNT="?"; DEVICES_COUNT="?"; DEVICE_KEYS="(install jq for details)"; SKIP_VERSION="?"
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

if [ "$HTTP_CODE" = "304" ]; then
  echo -e "   ${GREEN}✓ Cache HIT — 304 correto (bundle não mudou)${NC}"
elif [ "$HTTP_CODE" = "200" ]; then
  echo -e "   ${YELLOW}⚠ Cache MISS — bundle mudou (ou VERSION_ID vazio — instale jq)${NC}"
  if command -v jq &>/dev/null; then
    NEW_VERSION=$(echo "$BODY" | jq -r '.data.meta.version // empty')
    echo "   Nova version: $NEW_VERSION"
  fi
else
  echo -e "   ${RED}Erro inesperado${NC}"
  echo "   Response: $BODY"
fi

echo ""

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
