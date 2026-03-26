#!/bin/bash
# Fetch simplified alarm bundle — Supervia MARACANÃ / Central
# Customer: Supervia MARACANÃ (46260fbb-89b6-4166-b81e-7bca0b0dc78e)
# Central:  e5ce2467-4587-443b-b545-b294d8f58209

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="46260fbb-89b6-4166-b81e-7bca0b0dc78e"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID="e5ce2467-4587-443b-b545-b294d8f58209"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_central.json"

echo "Fetching simplified bundle — Supervia MARACANÃ (central)..."
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
