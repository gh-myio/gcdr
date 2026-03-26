#!/bin/bash
# Fetch simplified alarm bundle — Supervia ENG. DE DENTRO
# Customer: Supervia ENG. DE DENTRO (0193eac5-68ff-443b-baed-3cd61a5e6c37)
# Centrals: 16618030-837b-11f0-a06d-e9509531b1d5
#           a5708ba0-8389-11f0-a06d-e9509531b1d5
# Central:  sem filtro — retorna todos os devices do customer
# Para filtrar por central use: fetch-simple-bundle-central-1.sh / fetch-simple-bundle-central-2.sh

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="0193eac5-68ff-443b-baed-3cd61a5e6c37"
API_KEY="gcdr_supervia_estacoes_bundle_key_2026"
CENTRAL_ID=""
OUTPUT_FILE="$(dirname "$0")/simple_bundle_output.json"

echo "Fetching simplified bundle — Supervia ENG. DE DENTRO..."
echo "Customer: $CUSTOMER_ID"
echo "Central:  ${CENTRAL_ID:-<todos>}"
echo ""

curl -s "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  ${CENTRAL_ID:+-H "X-Central-Id: ${CENTRAL_ID}"} \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
  echo "Bundle saved to: $OUTPUT_FILE"
  echo ""
  echo "=== meta ==="
  jq '.data.meta' "$OUTPUT_FILE" 2>/dev/null || head -30 "$OUTPUT_FILE"
  echo ""
  echo "=== deviceIndex keys ==="
  jq '.data.deviceIndex | keys' "$OUTPUT_FILE" 2>/dev/null
  echo ""
  echo "=== rules keys ==="
  jq '.data.rules | keys' "$OUTPUT_FILE" 2>/dev/null
else
  echo "Error fetching bundle"
  exit 1
fi
