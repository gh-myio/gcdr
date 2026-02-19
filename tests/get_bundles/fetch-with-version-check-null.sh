#!/bin/bash
# =============================================================================
# Test: Fetch bundle with NULL version, then re-fetch with the returned version
# =============================================================================
# Step 1: GET /simple WITHOUT X-Version-Id (null) -> expects 200 + full bundle
#         Saves to simple_bundle_output_null_version.json
# Step 2: GET /simple WITH X-Version-Id from step 1 -> expects 304
#         Saves to simple_bundle_output_second_time_last_version.json
# =============================================================================

# Configuration
#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="77777777-7777-7777-7777-777777777777"
API_KEY="gcdr_cust_test_bundle_key_myio2026"
CENTRAL_ID="9308af89-94b2-45e6-9e47-ae78f881afd2"

# Resolve absolute path so it works regardless of where you run from
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_1="${SCRIPT_DIR}/simple_bundle_output_null_version.json"
OUTPUT_2="${SCRIPT_DIR}/simple_bundle_output_second_time_last_version.json"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "============================================================"
echo "  Bundle Version Check: NULL -> Returned Version"
echo "============================================================"
echo ""
echo "  API:      $API_URL"
echo "  Customer: $CUSTOMER_ID"
echo "  Central:  $CENTRAL_ID"
echo "  Output 1: $OUTPUT_1"
echo "  Output 2: $OUTPUT_2"
echo ""

# =====================================================================
# STEP 1: Request WITHOUT X-Version-Id (null version)
# =====================================================================
echo "------------------------------------------------------------"
echo -e "  ${CYAN}STEP 1: GET /simple (no X-Version-Id = null)${NC}"
echo "------------------------------------------------------------"
echo ""

RESPONSE_1=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Central-Id: ${CENTRAL_ID}" \
  -H "Accept: application/json")

HTTP_CODE_1=$(echo "$RESPONSE_1" | tail -n1)
BODY_1=$(echo "$RESPONSE_1" | sed '$d')

echo "  HTTP Status: $HTTP_CODE_1"

if [ "$HTTP_CODE_1" != "200" ]; then
  echo -e "  ${RED}ERROR: Expected 200, got $HTTP_CODE_1${NC}"
  echo ""
  echo "  Response: $BODY_1"
  exit 1
fi

# Save body to file
echo "$BODY_1" > "$OUTPUT_1"

# Extract versionId from response JSON: { "data": { "versionId": "v1-xxx" } }
VERSION_ID=$(echo "$BODY_1" | grep -o '"versionId":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$VERSION_ID" ]; then
  echo -e "  ${RED}ERROR: Could not extract versionId from response${NC}"
  echo ""
  echo "  Response preview:"
  echo "$BODY_1" | head -5
  exit 1
fi

# Extract counts from response
RULES_COUNT=$(echo "$BODY_1" | grep -o '"rulesCount":[0-9]*' | head -1 | cut -d':' -f2)
DEVICES_COUNT=$(echo "$BODY_1" | grep -o '"devicesCount":[0-9]*' | head -1 | cut -d':' -f2)
FILE_SIZE=$(wc -c < "$OUTPUT_1" | tr -d ' ')

echo -e "  ${GREEN}OK - Got full bundle${NC}"
echo ""
echo "  Version:  $VERSION_ID"
echo "  Rules:    ${RULES_COUNT:-?}"
echo "  Devices:  ${DEVICES_COUNT:-?}"
echo "  Size:     $FILE_SIZE bytes"
echo "  Saved to: $OUTPUT_1"
echo ""

# =====================================================================
# STEP 2: Request WITH X-Version-Id from step 1
# =====================================================================
echo "------------------------------------------------------------"
echo -e "  ${CYAN}STEP 2: GET /simple (X-Version-Id: $VERSION_ID)${NC}"
echo "------------------------------------------------------------"
echo ""

RESPONSE_2=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Central-Id: ${CENTRAL_ID}" \
  -H "X-Version-Id: ${VERSION_ID}" \
  -H "Accept: application/json")

HTTP_CODE_2=$(echo "$RESPONSE_2" | tail -n1)
BODY_2=$(echo "$RESPONSE_2" | sed '$d')

echo "  HTTP Status: $HTTP_CODE_2"

# Always write the output file (even if body is small/empty for 304)
if [ -n "$BODY_2" ]; then
  echo "$BODY_2" > "$OUTPUT_2"
else
  echo "{\"status\":304,\"versionId\":\"$VERSION_ID\",\"message\":\"Not Modified\"}" > "$OUTPUT_2"
fi

if [ "$HTTP_CODE_2" = "304" ]; then
  echo -e "  ${GREEN}CACHE HIT - Bundle unchanged (304 Not Modified)${NC}"
  echo ""
  echo "  The bundle has not changed since version $VERSION_ID."
  echo "  Node-RED can keep using its cached copy."
  echo "  Body:     $BODY_2"
  echo "  Saved to: $OUTPUT_2"
elif [ "$HTTP_CODE_2" = "200" ]; then
  NEW_VERSION=$(echo "$BODY_2" | grep -o '"versionId":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo -e "  ${YELLOW}CACHE MISS - Bundle changed (200 OK)${NC}"
  echo ""
  echo "  Previous: $VERSION_ID"
  echo "  Current:  $NEW_VERSION"
  echo "  The bundle was regenerated between the two requests."
  echo "  Saved to: $OUTPUT_2"
else
  echo -e "  ${RED}ERROR: Unexpected HTTP status $HTTP_CODE_2${NC}"
  echo ""
  echo "  Response: $BODY_2"
  exit 1
fi

echo ""
echo "============================================================"
echo "  Summary"
echo "============================================================"
echo ""
echo "  Step 1 (null version):     $HTTP_CODE_1  ->  $OUTPUT_1"
echo "  Step 2 (version $VERSION_ID): $HTTP_CODE_2  ->  $OUTPUT_2"
echo ""
echo "  Files created:"
[ -f "$OUTPUT_1" ] && echo -e "    ${GREEN}[OK]${NC} $OUTPUT_1 ($(wc -c < "$OUTPUT_1" | tr -d ' ') bytes)"
[ -f "$OUTPUT_2" ] && echo -e "    ${GREEN}[OK]${NC} $OUTPUT_2 ($(wc -c < "$OUTPUT_2" | tr -d ' ') bytes)"
[ ! -f "$OUTPUT_1" ] && echo -e "    ${RED}[MISSING]${NC} $OUTPUT_1"
[ ! -f "$OUTPUT_2" ] && echo -e "    ${RED}[MISSING]${NC} $OUTPUT_2"
echo ""
echo "============================================================"
