#!/bin/bash
# Fetch simplified alarm bundle and save to JSON file

API_URL="http://localhost:3015"
CUSTOMER_ID="33333333-3333-3333-3333-333333333333"
API_KEY="gcdr_cust_nodered_test_bundle_key_2024"
TENANT_ID="11111111-1111-1111-1111-111111111111"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_output.json"

echo "Fetching simplified bundle..."
echo "Customer: $CUSTOMER_ID"
echo ""

curl -s "${API_URL}/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
  echo "Bundle saved to: $OUTPUT_FILE"
  echo ""
  echo "Preview:"
  head -30 "$OUTPUT_FILE"
else
  echo "Error fetching bundle"
  exit 1
fi
