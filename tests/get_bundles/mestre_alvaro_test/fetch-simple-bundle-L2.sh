#!/bin/bash
# Fetch simplified alarm bundle — Mestre Álvaro / Central L2
# Customer:  e04046d4-baa4-44e9-a378-4dfebe4140f1 (Shopping Mestre Álvaro)
# Central:   d3202744-05dd-46d1-af33-495e9a2ecd52 (MAGATEWAY-L2)

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"
API_KEY="gcdr_alarm_integration_key_2026"
CENTRAL_ID="d3202744-05dd-46d1-af33-495e9a2ecd52"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_L2.json"

echo "Fetching simplified bundle — Mestre Álvaro L2 (MAGATEWAY-L2)..."
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
