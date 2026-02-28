#!/bin/bash
# Test X-Central-Id validation on the alarm bundle endpoint
# Scenarios:
#   1. Valid central that belongs to the customer        → 200
#   2. Central ID that does not exist                   → 404 CENTRAL_NOT_FOUND
#   3. Central that exists but belongs to another customer → 403 CENTRAL_CUSTOMER_MISMATCH

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"   # Shopping Mestre Álvaro
API_KEY="gcdr_alarm_integration_key_2026"

# Centrais válidas do Mestre Álvaro
CENTRAL_L1="45250d44-bad0-4071-aaa0-8091cfb12691"    # MAGATEWAY-L1 ✓
# Central de outro customer (Moxuara)
CENTRAL_OTHER="e982edf9-edb1-4aa6-8a14-4782465ae5a3"
# UUID inexistente
CENTRAL_FAKE="00000000-0000-0000-0000-000000000099"

ENDPOINT="${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple"

LOG_FILE="$(dirname "$0")/central-validation-$(date +%Y%m%d_%H%M%S).log"
exec > >(tee >(sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE")) 2>&1

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
  local LABEL="$1"
  local CENTRAL="$2"
  local EXPECT_CODE="$3"

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    "$ENDPOINT" \
    -H "X-API-Key: ${API_KEY}" \
    -H "X-Central-Id: ${CENTRAL}" \
    -H "Accept: application/json")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "$EXPECT_CODE" ]; then
    echo -e "   ${GREEN}✓ PASS${NC} — Status: $HTTP_CODE (esperado $EXPECT_CODE)"
  else
    echo -e "   ${RED}✗ FAIL${NC} — Status: $HTTP_CODE (esperado $EXPECT_CODE)"
  fi

  if command -v jq &>/dev/null; then
    CODE=$(echo "$BODY" | jq -r '.error.code // .versionId // "ok"' 2>/dev/null)
    MSG=$(echo "$BODY"  | jq -r '.error.message // .message // ""' 2>/dev/null)
    [ -n "$CODE" ] && echo "   code:    $CODE"
    [ -n "$MSG"  ] && echo "   message: $MSG"
  else
    echo "   $BODY" | head -3
  fi
}

echo "=== Central Validation Tests — Mestre Álvaro ==="
echo "Customer: $CUSTOMER_ID"
echo "Log: $LOG_FILE"
echo ""

echo "1. Central válida (L1 — pertence ao customer)..."
echo "   Central: $CENTRAL_L1"
check "valid" "$CENTRAL_L1" "200"
echo ""

echo "2. Central inexistente (UUID fake)..."
echo "   Central: $CENTRAL_FAKE"
check "not-found" "$CENTRAL_FAKE" "404"
echo ""

echo "3. Central de outro customer (Moxuara)..."
echo "   Central: $CENTRAL_OTHER"
check "mismatch" "$CENTRAL_OTHER" "403"
echo ""

echo "=== Done ==="
echo "Log salvo em: $LOG_FILE"
