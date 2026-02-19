#!/bin/bash
# Fetch simplified alarm bundle with X-Version-Id header to test 304 cache validation

# Configuration - Change API_URL for different environments
# Local: http://localhost:3015
# Production: https://gcdr-server.apps.myio-bas.com
#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="77777777-7777-7777-7777-777777777777"
# Fixed test API key (seeded in database)
API_KEY="gcdr_cust_test_bundle_key_myio2026"
# X-Central-Id is optional - filters devices by central ID
CENTRAL_ID="9308af89-94b2-45e6-9e47-ae78f881afd2"
# Version ID to test cache validation (should return 304 if matches current bundle)
VERSION_ID="v1-20260211-184138"

echo "Fetching simplified bundle with X-Version-Id..."
echo "Customer:   $CUSTOMER_ID"
echo "Central:    $CENTRAL_ID"
echo "Version-Id: $VERSION_ID"
echo ""

HTTP_CODE=$(curl -s -o /tmp/bundle_response.json -w "%{http_code}" \
  "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Central-Id: ${CENTRAL_ID}" \
  -H "X-Version-Id: ${VERSION_ID}" \
  -H "Accept: application/json")

echo "HTTP Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" = "304" ]; then
  echo "Result: NOT MODIFIED (cache hit - bundle unchanged)"
  echo ""
  echo "Response body:"
  cat /tmp/bundle_response.json
elif [ "$HTTP_CODE" = "200" ]; then
  echo "Result: OK (cache miss - bundle regenerated with new version)"
  echo ""
  echo "Response preview:"
  head -30 /tmp/bundle_response.json
else
  echo "Error: unexpected HTTP status $HTTP_CODE"
  echo ""
  cat /tmp/bundle_response.json
  exit 1
fi
