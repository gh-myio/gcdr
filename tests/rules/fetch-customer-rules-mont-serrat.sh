#!/bin/bash
# Fetch all rules for Mont Serrat customer
# Customer: Mont Serrat (a4c64215-f7eb-4102-80b5-e10b98e2f94e)
# Endpoint: GET /api/v1/customers/:customerId/rules
#
# Optional query params:
#   ?type=ALARM_THRESHOLD|SLA|ESCALATION|MAINTENANCE_WINDOW|DEVICE_OFFLINE
#   ?enabled=true|false
#   ?internalRule=true|false
#   ?isInternalSupportRule=true|false
#   ?limit=50
#   ?search=<name>

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="a4c64215-f7eb-4102-80b5-e10b98e2f94e"
API_KEY="gcdr_alarm_integration_key_2026"
OUTPUT_FILE="$(dirname "$0")/mont-serrat-rules.json"

# Optional filters (uncomment to use)
PARAMS=""
# PARAMS="?type=ALARM_THRESHOLD"
# PARAMS="?enabled=true&limit=50"
# PARAMS="?internalRule=false"
# PARAMS="?isInternalSupportRule=true"

echo "Fetching rules — Mont Serrat..."
echo "Customer: $CUSTOMER_ID"
echo "Params:   ${PARAMS:-<none>}"
echo ""

curl -s "${API_URL}/api/v1/customers/${CUSTOMER_ID}/rules${PARAMS}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
  echo "Saved to: $OUTPUT_FILE"
  echo ""
  echo "=== total ==="
  jq '.data.pagination.total' "$OUTPUT_FILE" 2>/dev/null

  echo ""
  echo "=== rules (id | type | name | enabled) ==="
  jq -r '.data.items[] | "\(.id)  \(.type)  \(.enabled)  \(.name)"' "$OUTPUT_FILE" 2>/dev/null
else
  echo "Error fetching rules"
  cat "$OUTPUT_FILE" 2>/dev/null
  exit 1
fi
