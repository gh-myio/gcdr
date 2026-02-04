#!/bin/bash
# Fetch simplified alarm bundle and save to JSON file

# Configuration - Change API_URL for different environments
# Local: http://localhost:3015
# Production: https://gcdr-server.apps.myio-bas.com
#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="77777777-7777-7777-7777-777777777777"
# Fixed test API key (seeded in database)
API_KEY="gcdr_cust_test_bundle_key_myio2026"
# X-Tenant-Id is optional - tenant is auto-discovered from API key
OUTPUT_FILE="$(dirname "$0")/simple_bundle_output.json"

echo "Fetching simplified bundle..."
echo "Customer: $CUSTOMER_ID"
echo ""

curl -s "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
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
