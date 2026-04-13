#!/bin/bash
# Fetch simplified alarm bundle for Metrópole Ananindeua and save to JSON file
# Customer: Metrópole Ananindeua (c4030d78-1cf4-4bf6-8eed-c12b4e7c281a)
# Central:  sem filtro — retorna todos os devices do customer
# Para filtrar por central use: fetch-simple-bundle-central.sh

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="c4030d78-1cf4-4bf6-8eed-c12b4e7c281a"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID=""
OUTPUT_FILE="$(dirname "$0")/simple_bundle_output.json"

echo "Fetching simplified bundle — Metrópole Ananindeua..."
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
