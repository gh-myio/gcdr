#!/bin/bash
# Fetch simplified alarm bundle — Shopping da Ilha / Central principal
# Customer: Shopping da Ilha (f1fcf434-532b-428a-a5e1-0b68e8ae1056)
# Central:  cb318f02-1020-4f99-857f-d44d001d939b

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="f1fcf434-532b-428a-a5e1-0b68e8ae1056"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID="cb318f02-1020-4f99-857f-d44d001d939b"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_central.json"

echo "Fetching simplified bundle — Shopping da Ilha Central..."
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
