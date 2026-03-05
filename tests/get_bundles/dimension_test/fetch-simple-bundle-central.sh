#!/bin/bash
# Fetch simplified alarm bundle — Dimension / Central principal
# Customer: Dimension (77777777-7777-7777-7777-777777777777)
# Central:  9308af89-94b2-45e6-9e47-ae78f881afd2 (DIMENSION-GATEWAY)

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="77777777-7777-7777-7777-777777777777"
API_KEY="gcdr_dimension_bundle_key_2026"
CENTRAL_ID="9308af89-94b2-45e6-9e47-ae78f881afd2"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_central.json"

echo "Fetching simplified bundle — Dimension Central (DIMENSION-GATEWAY)..."
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
