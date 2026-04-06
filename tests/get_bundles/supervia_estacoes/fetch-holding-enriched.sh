#!/bin/bash
# Fetch enriched parent customer (holding) — Supervia Estações
# Endpoint: GET /customers/external/:externalId?deep=1&allRules=1&filterOnlyDevicesWithRules=1
#
# Comportamento com deep=1 quando o customer tem filhos:
#   { customer: <pai>, children: [ { customer, assets, devices, rules }, ... ] }
#
# GCDR Customer ID (holding): 01c0179c-08d5-4bb8-9a3c-743327ac63d1
# Tenant ID:                  11111111-1111-1111-1111-111111111111

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
GCDR_CUSTOMER_ID="01c0179c-08d5-4bb8-9a3c-743327ac63d1"
API_KEY="gcdr_supervia_estacoes_bundle_key_2026"
TENANT_ID="11111111-1111-1111-1111-111111111111"
OUTPUT_FILE="$(dirname "$0")/holding_enriched_output.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "=== Supervia Estações — Holding Enriched (pai + filhos) ==="
echo "GCDR Customer ID: $GCDR_CUSTOMER_ID"
echo ""

# ─── Step 1: Lookup external_id via GCDR Customer ID ────────────────────────
echo "1. Buscando external_id do holding via GET /customers/:id ..."
CUSTOMER_RESP=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/customers/${GCDR_CUSTOMER_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  -H "Accept: application/json")

HTTP_CODE=$(echo "$CUSTOMER_RESP" | tail -n1)
CUSTOMER_BODY=$(echo "$CUSTOMER_RESP" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo -e "   ${RED}Erro ao buscar customer: HTTP $HTTP_CODE${NC}"
  echo "   $CUSTOMER_BODY"
  exit 1
fi

EXTERNAL_ID=$(echo "$CUSTOMER_BODY" | jq -r '.data.externalId // empty')
CUSTOMER_NAME=$(echo "$CUSTOMER_BODY" | jq -r '.data.name // empty')

if [ -z "$EXTERNAL_ID" ]; then
  echo -e "   ${YELLOW}⚠ externalId não definido para este customer.${NC}"
  echo "   Defina o ThingsBoard UUID em customers.external_id antes de usar este endpoint."
  exit 1
fi

echo -e "   ${GREEN}✓ Customer: $CUSTOMER_NAME${NC}"
echo "   external_id (TB UUID): $EXTERNAL_ID"
echo ""

# ─── Step 2: Fetch enriched holding — pai + filhos ──────────────────────────
echo "2. Fetching holding enriched — GET /customers/external/$EXTERNAL_ID?deep=1&allRules=1&filterOnlyDevicesWithRules=1 ..."

RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/customers/external/${EXTERNAL_ID}?deep=1&allRules=1&filterOnlyDevicesWithRules=1" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  -H "Accept: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "   Status: $HTTP_CODE"

if [ "$HTTP_CODE" != "200" ]; then
  echo -e "   ${RED}Erro: HTTP $HTTP_CODE${NC}"
  echo "   $BODY"
  exit 1
fi

echo "$BODY" > "$OUTPUT_FILE"
echo -e "   ${GREEN}✓ Payload salvo em: $OUTPUT_FILE${NC}"
echo "   Tamanho: $(echo "$BODY" | wc -c) bytes"
echo ""

# ─── Step 3: Summary ─────────────────────────────────────────────────────────
echo "=== Resumo ==="

PARENT_NAME=$(echo "$BODY"  | jq -r '.data.customer.name // "N/A"')
CHILDREN_COUNT=$(echo "$BODY" | jq '.data.children | length // 0')

echo "Pai:     $PARENT_NAME"
echo "Filhos:  $CHILDREN_COUNT"
echo ""

if [ "$CHILDREN_COUNT" -gt 0 ] 2>/dev/null; then
  echo "--- Filhos ---"
  echo "$BODY" | jq -r '.data.children[] | "  [\(.customer.name)] devices=\(.devices | length) assets=\(.assets | length) rules=\(.rules | length)"'
  echo ""
  echo "--- devices por filho ---"
  echo "$BODY" | jq -r '.data.children[] | "  \(.customer.name): " + (.devices | map(.label // .code // .id) | join(", "))'
fi

echo ""
echo "=== Done ==="
