#!/bin/bash
# Fetch simplified alarm bundle — Rio Poty / Central principal
# Customer: Rio Poty (8f9af056-10c2-4cd4-a45f-ab0c99377aca)
# Central:  c0af8288-7b13-4024-bc11-df5017fef656

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="8f9af056-10c2-4cd4-a45f-ab0c99377aca"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID="c0af8288-7b13-4024-bc11-df5017fef656"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_central.json"

echo "Fetching simplified bundle — Rio Poty Central..."
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
