#!/bin/bash
# Fetch simplified alarm bundle — Supervia ENG. DE DENTRO / Central 1
# Customer: Supervia ENG. DE DENTRO (0193eac5-68ff-443b-baed-3cd61a5e6c37)
# Central:  16618030-837b-11f0-a06d-e9509531b1d5

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="0193eac5-68ff-443b-baed-3cd61a5e6c37"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID="16618030-837b-11f0-a06d-e9509531b1d5"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_central_1.json"

echo "Fetching simplified bundle — Supervia ENG. DE DENTRO (central 1)..."
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
