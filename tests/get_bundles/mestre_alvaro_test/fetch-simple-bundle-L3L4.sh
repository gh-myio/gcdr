#!/bin/bash
# Fetch simplified alarm bundle — Mestre Álvaro / Central L3-L4
# Customer:  e04046d4-baa4-44e9-a378-4dfebe4140f1 (Shopping Mestre Álvaro)
# Central:   fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e (MAGATEWAY-L3L4)

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID="fcb3ccd1-4b85-4cef-a1de-0b8a80bec81e"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_L3L4.json"

echo "Fetching simplified bundle — Mestre Álvaro L3-L4 (MAGATEWAY-L3L4)..."
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
