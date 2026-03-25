#!/bin/bash
# Simulate the alarm orchestrator lookup flow for DEVICE_OFFLINE
#
# This script replicates what the orchestrator does upon receiving a heartbeat:
#   1. Fetch DEVICE_OFFLINE rule  → get centralId + schedule + guard configs
#   2. Fetch devices by centralId → build slaveId → deviceId map
#   3. Simulate a heartbeat payload with mixed ONLINE/OFFLINE slaves
#   4. Show which alarms would be opened / closed
#
# Customer: Moxuara (84e0370e-636a-4741-9874-504b5e0b3577)
# Central:  d3202744-05dd-46d1-af33-495e9a2ecd52

#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"
CUSTOMER_ID="84e0370e-636a-4741-9874-504b5e0b3577"
CENTRAL_ID="d3202744-05dd-46d1-af33-495e9a2ecd52"
API_KEY="gcdr_alarm_integration_key_2026"

# Simulated heartbeat slaves (edit to match real slave IDs)
# Format: "slaveId:status"  status = ONLINE | OFFLINE
SIMULATED_SLAVES=(
  "1:ONLINE"
  "2:OFFLINE"
  "3:OFFLINE"
  "4:ONLINE"
)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

LOG_FILE="$(dirname "$0")/orchestrator-lookup-$(date +%Y%m%d_%H%M%S).log"
exec > >(tee >(sed 's/\x1b\[[0-9;]*m//g' >> "$LOG_FILE")) 2>&1

echo "=== Simulate Orchestrator Lookup — DEVICE_OFFLINE / Moxuara ==="
echo "Log: $LOG_FILE"
echo "Customer: $CUSTOMER_ID"
echo "Central:  $CENTRAL_ID"
echo ""

# ─────────────────────────────────────────────────────────────
# Step 1: Fetch DEVICE_OFFLINE rule
# ─────────────────────────────────────────────────────────────
echo -e "${CYAN}1. Fetching DEVICE_OFFLINE rule...${NC}"

RULES_RESP=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/customers/${CUSTOMER_ID}/rules?type=DEVICE_OFFLINE&internalRule=true" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Accept: application/json")

RULES_CODE=$(echo "$RULES_RESP" | tail -n1)
RULES_BODY=$(echo "$RULES_RESP" | sed '$d')

if [ "$RULES_CODE" != "200" ]; then
  echo -e "   ${RED}Error $RULES_CODE fetching rule${NC}"
  echo "   $RULES_BODY"
  exit 1
fi

RULE_COUNT=$(echo "$RULES_BODY" | jq '.data.items | length' 2>/dev/null)
echo "   Rules found: $RULE_COUNT"

if [ "$RULE_COUNT" = "0" ] || [ -z "$RULE_COUNT" ]; then
  echo -e "   ${YELLOW}No DEVICE_OFFLINE rule found for this customer.${NC}"
  echo "   Run: scripts/db/ops/moxuara-device-offline-rule.sql"
  exit 1
fi

RULE_ID=$(echo "$RULES_BODY"    | jq -r '.data.items[0].id')
RULE_NAME=$(echo "$RULES_BODY"  | jq -r '.data.items[0].name')
START_AT=$(echo "$RULES_BODY"   | jq -r '.data.items[0].alarmConfig.startAt // "00:00"')
END_AT=$(echo "$RULES_BODY"     | jq -r '.data.items[0].alarmConfig.endAt   // "23:59"')
DAYS_RAW=$(echo "$RULES_BODY"   | jq -r '.data.items[0].alarmConfig.daysOfWeek // [] | @json')
COOLDOWN=$(echo "$RULES_BODY"   | jq    '.data.items[0].alarmConfig.cooldown  // null')
DEDUP=$(echo "$RULES_BODY"      | jq    '.data.items[0].alarmConfig.dedup     // null')

echo -e "   ${GREEN}Rule found OK${NC}"
echo "   id:       $RULE_ID"
echo "   name:     $RULE_NAME"
echo "   schedule: $START_AT – $END_AT  days=$DAYS_RAW"
echo "   cooldown: $COOLDOWN"
echo "   dedup:    $DEDUP"
echo ""

# ─────────────────────────────────────────────────────────────
# Step 2: Fetch devices by centralId
# ─────────────────────────────────────────────────────────────
echo -e "${CYAN}2. Fetching devices for central $CENTRAL_ID...${NC}"

DEVICES_RESP=$(curl -s -w "\n%{http_code}" \
  "${API_URL}/api/v1/devices?customerId=${CUSTOMER_ID}&centralId=${CENTRAL_ID}&limit=500" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Accept: application/json")

DEVICES_CODE=$(echo "$DEVICES_RESP" | tail -n1)
DEVICES_BODY=$(echo "$DEVICES_RESP" | sed '$d')

if [ "$DEVICES_CODE" != "200" ]; then
  echo -e "   ${RED}Error $DEVICES_CODE fetching devices${NC}"
  echo "   $DEVICES_BODY"
  exit 1
fi

DEVICE_COUNT=$(echo "$DEVICES_BODY" | jq '.data.items | length' 2>/dev/null)
echo "   Devices found: $DEVICE_COUNT"
echo ""

echo "   slaveId → deviceId map:"
echo "$DEVICES_BODY" | jq -r '.data.items[] | "   \(.slaveId // "?")\t→  \(.id)\t\(.name)"' 2>/dev/null | sort -n -k1
echo ""

# ─────────────────────────────────────────────────────────────
# Step 3: Simulate heartbeat processing
# ─────────────────────────────────────────────────────────────
echo -e "${CYAN}3. Simulating heartbeat payload...${NC}"
echo ""
echo "   Simulated slaves:"
for entry in "${SIMULATED_SLAVES[@]}"; do
  SLAVE_ID="${entry%%:*}"
  STATUS="${entry##*:}"
  echo "     slaveId=$SLAVE_ID  status=$STATUS"
done
echo ""

echo -e "${CYAN}4. Alarm actions (orchestrator decision)...${NC}"
echo ""

for entry in "${SIMULATED_SLAVES[@]}"; do
  SLAVE_ID="${entry%%:*}"
  STATUS="${entry##*:}"

  DEVICE_ID=$(echo "$DEVICES_BODY" | jq -r --argjson sid "$SLAVE_ID" \
    '.data.items[] | select(.slaveId == $sid) | .id' 2>/dev/null)
  DEVICE_NAME=$(echo "$DEVICES_BODY" | jq -r --argjson sid "$SLAVE_ID" \
    '.data.items[] | select(.slaveId == $sid) | .name' 2>/dev/null)

  if [ -z "$DEVICE_ID" ]; then
    echo -e "   slaveId=$SLAVE_ID  ${YELLOW}⚠ device not found in GCDR${NC}"
    continue
  fi

  if [ "$STATUS" = "OFFLINE" ]; then
    echo -e "   slaveId=$SLAVE_ID  ${RED}● OFFLINE${NC}  → OPEN alarm"
    echo "      deviceId:   $DEVICE_ID"
    echo "      deviceName: $DEVICE_NAME"
    echo "      ruleId:     $RULE_ID"
  else
    echo -e "   slaveId=$SLAVE_ID  ${GREEN}● ONLINE${NC}   → CLOSE alarm (if open)"
    echo "      deviceId:   $DEVICE_ID"
    echo "      deviceName: $DEVICE_NAME"
  fi
  echo ""
done

echo "=== Done ==="
echo "Log saved to: $LOG_FILE"
