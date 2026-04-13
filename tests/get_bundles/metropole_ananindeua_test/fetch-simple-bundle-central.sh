#!/bin/bash
# Fetch simplified alarm bundle — Metrópole Ananindeua / Central principal
# Customer: Metrópole Ananindeua (c4030d78-1cf4-4bf6-8eed-c12b4e7c281a)
# Central:  7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a  (GCDR gateway central)
# Asset:    67b27a26-127e-4299-86d5-ea87cbabd665  (Central Metrópole Ananindeua Asset)
# Node-RED: d3202744-05dd-46d1-af33-495e9a2ecd52  (ID real do Node-RED — deve coincidir com o GCDR)

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="c4030d78-1cf4-4bf6-8eed-c12b4e7c281a"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID="7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_central.json"

echo "Fetching simplified bundle — Metrópole Ananindeua Central..."
echo "Customer: $CUSTOMER_ID"
echo "Central:  $CENTRAL_ID"
echo ""

curl -s "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Central-Id: ${CENTRAL_ID}" \
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
