#!/bin/bash
# Fetch simplified alarm bundle with version check (cache validation)
# Demonstrates X-Version-Id header usage

# Configuration
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="77777777-7777-7777-7777-777777777777"
API_KEY="gcdr_cust_test_bundle_key_myio2026"
CENTRAL_ID="9308af89-94b2-45e6-9e47-ae78f881afd2"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Bundle Version Check Demo ==="
echo ""

# Step 1: First request - no version (gets full bundle)
echo "1. First request (no X-Version-Id)..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Central-Id: ${CENTRAL_ID}" \
  -H "Accept: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "   Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  # Extract versionId from response
  VERSION_ID=$(echo "$BODY" | grep -o '"versionId":"[^"]*"' | cut -d'"' -f4)
  echo -e "   ${GREEN}Got full bundle${NC}"
  echo "   Version: $VERSION_ID"
  echo "   Payload size: $(echo "$BODY" | wc -c) bytes"
else
  echo "   Error: $BODY"
  exit 1
fi

echo ""

# Step 2: Second request - with version (should get 304)
echo "2. Second request (with X-Version-Id: $VERSION_ID)..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Central-Id: ${CENTRAL_ID}" \
  -H "X-Version-Id: ${VERSION_ID}" \
  -H "Accept: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "   Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "304" ]; then
  echo -e "   ${GREEN}Cache HIT - No changes${NC}"
  echo "   Response: $BODY"
else
  echo -e "   ${YELLOW}Cache MISS - Bundle changed${NC}"
  NEW_VERSION=$(echo "$BODY" | grep -o '"versionId":"[^"]*"' | cut -d'"' -f4)
  echo "   New version: $NEW_VERSION"
fi

echo ""

# Step 3: Request with wrong version (should get 200 with new bundle)
echo "3. Third request (with wrong X-Version-Id: v0-fake)..."
RESPONSE=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Central-Id: ${CENTRAL_ID}" \
  -H "X-Version-Id: v0-fake" \
  -H "Accept: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "   Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "   ${GREEN}Got full bundle (version mismatch)${NC}"
  echo "   Payload size: $(echo "$BODY" | wc -c) bytes"
elif [ "$HTTP_CODE" = "304" ]; then
  echo -e "   ${YELLOW}Unexpected 304${NC}"
fi

echo ""
echo "=== Demo Complete ==="
