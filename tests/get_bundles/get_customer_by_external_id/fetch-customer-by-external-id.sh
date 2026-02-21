#!/bin/bash
# Fetch customer by ThingsBoard externalId
# Payload returns the full customer object (externalId field included)

# Configuration - Change API_URL for different environments
# Local: http://localhost:3015
# Production: https://gcdr-api.a.myio-bas.com
#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"

# ThingsBoard Connector API Key (seeded in 13-customer-api-keys.sql)
API_KEY="gcdr_cust_tb_integration_key_2026"
TENANT_ID="11111111-1111-1111-1111-111111111111"

# Customer: "Moxuara"
# GCDR ID       : 84e0370e-636a-4741-9874-504b5e0b3577
# ThingsBoard ID: 5085bf40-b4dd-11f0-be7f-e760d1498268
EXTERNAL_ID="5085bf40-b4dd-11f0-be7f-e760d1498268"

OUTPUT_FILE="$(dirname "$0")/customer_enriched_output.json"

echo "Fetching customer by externalId..."
echo "Customer   : Moxuara (GCDR: 84e0370e-636a-4741-9874-504b5e0b3577)"
echo "ExternalId : $EXTERNAL_ID"
echo "Tenant     : $TENANT_ID"
echo ""

curl -s "${API_URL}/api/v1/customers/external/${EXTERNAL_ID}?deep=1" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
  echo "Response saved to: $OUTPUT_FILE"
  echo ""
  echo "--- Pretty print ---"
  cat "$OUTPUT_FILE" | python3 -m json.tool 2>/dev/null || cat "$OUTPUT_FILE"
else
  echo "Error fetching customer"
  exit 1
fi
