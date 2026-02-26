#!/bin/bash
# Fetch simplified alarm bundle and save to JSON file

# Configuration - Change API_URL for different environments
# Local: http://localhost:3015
# Production: https://gcdr-api.a.myio-bas.com
#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="84e0370e-636a-4741-9874-504b5e0b3577"
#API_KEY="gcdr_cust_test_bundle_key_myio2026"
API_KEY="gcdr_alarm_integration_key_2026"
# X-Central-Id filters devices by central (gateway)
CENTRAL_ID="e982edf9-edb1-4aa6-8a14-4782465ae5a3"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_output.json"

echo "Fetching simplified bundle..."
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
  echo "Preview:"
  head -30 "$OUTPUT_FILE"
else
  echo "Error fetching bundle"
  exit 1
fi
