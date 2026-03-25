#!/bin/bash
# Fetch devices for Moxuara filtered by centralId
# Used by the alarm orchestrator to build the slaveId → deviceId mapping
#
# Customer: Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
# Central:  d3202744-05dd-46d1-af33-495e9a2ecd52 (heartbeat source)

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="84e0370e-636a-4741-9874-504b5e0b3577"
CENTRAL_ID="d3202744-05dd-46d1-af33-495e9a2ecd52"
API_KEY="gcdr_alarm_integration_key_2026"
OUTPUT_FILE="$(dirname "$0")/devices-by-central-output.json"

echo "=== Fetch Devices by Central — Moxuara ==="
echo "Customer: $CUSTOMER_ID"
echo "Central:  $CENTRAL_ID"
echo ""

curl -s "${API_URL}/api/v1/devices?customerId=${CUSTOMER_ID}&centralId=${CENTRAL_ID}&limit=500" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
  echo "Devices saved to: $OUTPUT_FILE"
  echo ""

  TOTAL=$(jq '.data.pagination.total // (.data.items | length)' "$OUTPUT_FILE" 2>/dev/null)
  echo "=== Total devices: $TOTAL ==="
  echo ""

  echo "=== slaveId → deviceId mapping ==="
  jq -r '.data.items[] | "\(.slaveId // "?")\t\(.id)\t\(.name)"' "$OUTPUT_FILE" 2>/dev/null \
    | sort -n \
    | awk 'BEGIN { printf "%-10s  %-38s  %s\n", "slaveId", "deviceId", "name"; print "" } { printf "%-10s  %-38s  %s\n", $1, $2, $3 }'
else
  echo "Error fetching devices"
  cat "$OUTPUT_FILE" 2>/dev/null
  exit 1
fi
