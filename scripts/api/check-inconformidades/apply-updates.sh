#!/bin/bash
# =============================================================================
# apply-updates.sh
# Reads all action-plan-*.json files and applies UPDATE + UPDATE_IDENTIFIER
# actions to GCDR via PATCH /api/v1/devices/:id.
#
# Field ownership (TB wins):
#   identifier, deviceProfile, label, slaveId, externalId
#
# Field ownership (GCDR wins — never overwritten):
#   centralId, customerId, assetId
#
# Auth modes:
#   --auth apikey   → X-API-Key header (default)
#   --auth jwt      → POST /auth/login with email + password
#
# Usage:
#   ./apply-updates.sh
#   ./apply-updates.sh --dry-run
#   ./apply-updates.sh --auth jwt
#   ./apply-updates.sh --action update_identifier   (only UPDATE_IDENTIFIER)
#   ./apply-updates.sh --action update              (only UPDATE)
#   GCDR_API_URL=http://localhost:3015 ./apply-updates.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/apply-updates-$(date +%Y%m%d-%H%M%S).log"

API_URL="${GCDR_API_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_myio_tenant_bundle_key_2026}"
ADMIN_EMAIL="${GCDR_EMAIL:-admin@gcdr.io}"
ADMIN_PASSWORD="${GCDR_PASSWORD:-Test123!}"
AUTH_MODE="${GCDR_AUTH_MODE:-apikey}"
DRY_RUN=false
ACTION_FILTER="all"   # all | update | update_identifier

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auth)    AUTH_MODE="$2";      shift 2 ;;
    --url)     API_URL="$2";        shift 2 ;;
    --dry-run) DRY_RUN=true;        shift ;;
    --action)  ACTION_FILTER="$2";  shift 2 ;;
    *) shift ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Required: '$1' not found."; exit 1; }; }
require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
AUTH_HEADER=""
if [[ "$AUTH_MODE" == "jwt" ]]; then
  echo -e "${CYAN}[INFO]${NC} Authenticating via JWT..."
  LOGIN=$(curl -s -X POST "$API_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
  JWT_TOKEN=$(echo "$LOGIN" | jq -r '.data.accessToken // .accessToken // empty')
  [[ -z "$JWT_TOKEN" ]] && { echo -e "${RED}[FAIL]${NC} Login failed"; echo "$LOGIN" | jq .; exit 1; }
  AUTH_HEADER="Authorization: Bearer $JWT_TOKEN"
  echo -e "${GREEN}[OK]${NC}   JWT obtained."
else
  AUTH_HEADER="X-API-Key: $API_KEY"
  echo -e "${GREEN}[OK]${NC}   API Key: ${API_KEY:0:24}..."
fi

gcdr_patch() {
  curl -s -X PATCH "$API_URL/api/v1/devices/$1" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$2"
}

# ---------------------------------------------------------------------------
# Extract TB-owned value from divergence string
# Format: "fieldName: TB='<value>' GCDR='<value>'"
# ---------------------------------------------------------------------------
extract_tb_value() {
  echo "$1" | sed "s/.*TB='\\([^']*\\)'.*/\\1/"
}

# ---------------------------------------------------------------------------
# Build PATCH body from divergences array (only TB-owned fields)
# ---------------------------------------------------------------------------
build_patch_body() {
  local divergences_json="$1"
  local tb_json="$2"

  # Start with empty object, add only TB-owned fields that are diverging
  local body="{}"

  while IFS= read -r div; do
    [[ -z "$div" ]] && continue
    field=$(echo "$div" | cut -d: -f1 | tr -d ' ')
    tb_val=$(extract_tb_value "$div")

    case "$field" in
      identifier)
        body=$(echo "$body" | jq --arg v "$tb_val" '. + {identifier: $v}')
        ;;
      deviceProfile)
        body=$(echo "$body" | jq --arg v "$tb_val" '. + {deviceProfile: $v}')
        ;;
      label)
        body=$(echo "$body" | jq --arg v "$tb_val" '. + {label: $v, displayName: $v}')
        ;;
      slaveId)
        if echo "$tb_val" | grep -qE '^[0-9]+$'; then
          body=$(echo "$body" | jq --argjson v "$tb_val" '. + {slaveId: $v}')
        fi
        ;;
      externalId)
        # externalId divergence: tb_val is the tbId (correct value)
        local tb_id
        tb_id=$(echo "$div" | sed "s/.*TB_id='\\([^']*\\)'.*/\\1/")
        body=$(echo "$body" | jq --arg v "$tb_id" '. + {externalId: $v}')
        ;;
      # centralId, customerId, assetId → GCDR owns, skip
    esac
  done <<< "$(echo "$divergences_json" | jq -r '.[]')"

  echo "$body"
}

# ---------------------------------------------------------------------------
# Locate action-plan files
# ---------------------------------------------------------------------------
PLANS=("$SCRIPT_DIR"/action-plan-*.json)
if [[ ${#PLANS[@]} -eq 0 || ! -f "${PLANS[0]}" ]]; then
  echo -e "${RED}[FAIL]${NC} No action-plan-*.json found in $SCRIPT_DIR"
  exit 1
fi

TOTAL_OK=0
TOTAL_SKIP=0
TOTAL_FAIL=0

echo -e "\n${BOLD}=== apply-updates: ${#PLANS[@]} plan(s) | filter=$ACTION_FILTER | dry-run=$DRY_RUN ===${NC}\n"
echo "timestamp|action|gcdrDeviceId|deviceName|status|fields_patched|error" > "$LOG_FILE"

process_items() {
  local plan_file="$1"
  local action_key="$2"   # "update" or "update_identifier"
  local action_label="$3" # "UPDATE" or "UPDATE_IDENTIFIER"

  local count
  count=$(jq ".actions.${action_key} | length" "$plan_file")
  [[ "$count" -eq 0 ]] && return

  echo -e "  ${YELLOW}${action_label}${NC}: $count item(s)"

  for i in $(seq 0 $((count - 1))); do
    item=$(jq ".actions.${action_key}[$i]" "$plan_file")
    device_name=$(echo "$item"  | jq -r '.deviceName')
    gcdr_id=$(echo "$item"      | jq -r '.gcdrDeviceId // ""')

    if [[ -z "$gcdr_id" ]]; then
      echo -e "    ${YELLOW}[SKIP]${NC} $device_name — no gcdrDeviceId"
      TOTAL_SKIP=$((TOTAL_SKIP + 1))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)|$action_label||$device_name|SKIP||no gcdrDeviceId" >> "$LOG_FILE"
      continue
    fi

    # UPDATE_IDENTIFIER: body built directly from identifierTb field
    if [[ "$action_key" == "update_identifier" ]]; then
      identifier_tb=$(echo "$item" | jq -r '.identifierTb // ""')
      if [[ -z "$identifier_tb" ]]; then
        echo -e "    ${YELLOW}[SKIP]${NC} $device_name — no identifierTb"
        TOTAL_SKIP=$((TOTAL_SKIP + 1))
        continue
      fi
      BODY=$(jq -n --arg v "$identifier_tb" '{identifier: $v}')
    else
      divergences=$(echo "$item" | jq '.divergences')
      tb_json=$(echo "$item"     | jq '.tb')
      BODY=$(build_patch_body "$divergences" "$tb_json")
    fi

    # Skip if body is empty (no TB-owned fields to patch)
    if [[ "$BODY" == "{}" ]]; then
      echo -e "    ${YELLOW}[SKIP]${NC} $device_name — no TB-owned fields to patch"
      TOTAL_SKIP=$((TOTAL_SKIP + 1))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)|$action_label|$gcdr_id|$device_name|SKIP||no TB-owned fields" >> "$LOG_FILE"
      continue
    fi

    fields_patched=$(echo "$BODY" | jq -r 'keys | join(",")')

    if [[ "$DRY_RUN" == "true" ]]; then
      echo -e "    ${CYAN}[DRY-RUN]${NC} $device_name → fields: $fields_patched"
      echo -e "             body: $(echo "$BODY" | jq -c .)"
      TOTAL_OK=$((TOTAL_OK + 1))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)|$action_label|$gcdr_id|$device_name|DRY-RUN|$fields_patched|" >> "$LOG_FILE"
      continue
    fi

    RESP=$(gcdr_patch "$gcdr_id" "$BODY")
    SUCCESS=$(echo "$RESP" | jq -r '.success // false')

    if [[ "$SUCCESS" == "true" ]]; then
      echo -e "    ${GREEN}[OK]${NC}   $device_name → patched: $fields_patched"
      TOTAL_OK=$((TOTAL_OK + 1))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)|$action_label|$gcdr_id|$device_name|OK|$fields_patched|" >> "$LOG_FILE"
    else
      err_msg=$(echo "$RESP" | jq -r '.error.message // .message // "unknown error"')
      err_details=$(echo "$RESP" | jq -r '.error.details // {} | to_entries | map("\(.key): \(.value[0])") | join(", ")' 2>/dev/null || true)
      echo -e "    ${RED}[FAIL]${NC} $device_name — $err_msg${err_details:+ ($err_details)}"
      TOTAL_FAIL=$((TOTAL_FAIL + 1))
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)|$action_label|$gcdr_id|$device_name|FAIL||$err_msg${err_details:+ ($err_details)}" >> "$LOG_FILE"
    fi
  done
}

for plan_file in "${PLANS[@]}"; do
  plan_name="$(basename "$plan_file" .json)"
  update_count=$(jq '.actions.update | length' "$plan_file")
  uid_count=$(jq '.actions.update_identifier | length' "$plan_file")

  [[ "$update_count" -eq 0 && "$uid_count" -eq 0 ]] && continue

  echo -e "${CYAN}▶ $(basename "$plan_file")${NC}"

  [[ "$ACTION_FILTER" == "all" || "$ACTION_FILTER" == "update" ]] && \
    process_items "$plan_file" "update" "UPDATE"

  [[ "$ACTION_FILTER" == "all" || "$ACTION_FILTER" == "update_identifier" ]] && \
    process_items "$plan_file" "update_identifier" "UPDATE_IDENTIFIER"

  echo ""
done

echo -e "${BOLD}=== done ===${NC}"
echo -e "  ${GREEN}OK${NC}    : $TOTAL_OK"
echo -e "  ${YELLOW}Skipped${NC}: $TOTAL_SKIP"
[[ $TOTAL_FAIL -gt 0 ]] && echo -e "  ${RED}Failed${NC} : $TOTAL_FAIL"
echo -e "  Log   : ${CYAN}$(basename "$LOG_FILE")${NC}"
echo ""

[[ $TOTAL_FAIL -gt 0 ]] && exit 2
exit 0
