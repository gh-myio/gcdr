#!/bin/bash
# Fetch simplified alarm bundle for Campinas G0 Nova and save to JSON file.
# Central: sem filtro — retorna todos os devices do customer.
# Para filtrar por central use: fetch-simple-bundle-central.sh

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="3a3edfe0-b3e0-11ef-9d80-0f53bf3519bb"
API_KEY="gcdr_75068349fe19e144b5743c7fd42eb48c5268f6640ca24c2f910f822ff0641393"
CENTRAL_ID=""
OUTPUT_FILE="$(dirname "$0")/simple_bundle_output.json"

echo "Fetching simplified bundle — Campinas G0 Nova..."
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
