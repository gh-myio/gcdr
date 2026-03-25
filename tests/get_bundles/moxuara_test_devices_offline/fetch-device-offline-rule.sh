#!/bin/bash
# Fetch DEVICE_OFFLINE internal rule for Moxuara
# Customer: Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
# Central:  d3202744-05dd-46d1-af33-495e9a2ecd52 (heartbeat source)
#
# This rule is NOT included in /bundle/simple (internalRule=true).
# It is consumed exclusively by the alarm orchestrator.

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="84e0370e-636a-4741-9874-504b5e0b3577"
API_KEY="gcdr_alarm_integration_key_2026"
OUTPUT_FILE="$(dirname "$0")/device-offline-rule-output.json"

echo "=== Fetch DEVICE_OFFLINE Rule — Moxuara ==="
echo "Customer: $CUSTOMER_ID"
echo ""

curl -s "${API_URL}/api/v1/customers/${CUSTOMER_ID}/rules?type=DEVICE_OFFLINE&internalRule=true" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
  echo "Rule saved to: $OUTPUT_FILE"
  echo ""
  echo "=== items ==="
  jq '.data.items[] | { id, name, type, priority, enabled, internalRule, alarmConfig }' "$OUTPUT_FILE" 2>/dev/null \
    || head -60 "$OUTPUT_FILE"
else
  echo "Error fetching rule"
  cat "$OUTPUT_FILE" 2>/dev/null
  exit 1
fi
