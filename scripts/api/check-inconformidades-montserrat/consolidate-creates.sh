#!/bin/bash
# =============================================================================
# consolidate-creates.sh
# Reads all action-plan-*.json files, POSTs each CREATE to GCDR API,
# and builds a consolidated TXT with the real gcdrDeviceId returned.
#
# Output format (one row per created device):
#   gcdrDeviceId|gcdrAssetId|central_id|slave_id|name|display_name|tb_id
#
# Auth modes:
#   --auth apikey   → X-API-Key header (default)
#   --auth jwt      → POST /auth/login with email + password
#
# Usage:
#   ./consolidate-creates.sh
#   ./consolidate-creates.sh --auth jwt
#   GCDR_API_URL=http://localhost:3015 ./consolidate-creates.sh
#   ./consolidate-creates.sh --dry-run   (prints POST body, no actual request)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_FILE="$SCRIPT_DIR/consolidated-creates-$(date +%Y%m%d-%H%M%S).txt"

# Load local config (overrides defaults; env vars still take precedence)
[[ -f "$SCRIPT_DIR/config.env" ]] && source "$SCRIPT_DIR/config.env"

API_URL="${GCDR_API_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_myio_tenant_bundle_key_2026}"
ADMIN_EMAIL="${GCDR_EMAIL:-admin@gcdr.io}"
ADMIN_PASSWORD="${GCDR_PASSWORD:-Test123!}"
AUTH_MODE="${GCDR_AUTH_MODE:-apikey}"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auth)    AUTH_MODE="$2";  shift 2 ;;
    --url)     API_URL="$2";    shift 2 ;;
    --out)     OUT_FILE="$SCRIPT_DIR/$2"; shift 2 ;;
    --dry-run) DRY_RUN=true;    shift ;;
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

gcdr_post() {
  curl -s -X POST "$API_URL/api/v1$1" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$2"
}

# ---------------------------------------------------------------------------
# Locate action-plan files
# ---------------------------------------------------------------------------
PLANS=("$SCRIPT_DIR"/action-plan-*.json)
if [[ ${#PLANS[@]} -eq 0 || ! -f "${PLANS[0]}" ]]; then
  echo -e "${RED}[FAIL]${NC} No action-plan-*.json found in $SCRIPT_DIR"
  exit 1
fi

# Write header
echo "gcdrDeviceId|gcdrAssetId|central_id|slave_id|name|display_name|tb_id" > "$OUT_FILE"

TOTAL_OK=0
TOTAL_FAIL=0

echo -e "\n${BOLD}=== consolidate-creates: ${#PLANS[@]} plan(s) ===${NC}\n"

for plan_file in "${PLANS[@]}"; do
  count=$(jq '.actions.create | length' "$plan_file")
  [[ "$count" -eq 0 ]] && continue

  echo -e "${CYAN}▶ $(basename "$plan_file")${NC} — $count create(s)"

  # Iterate over each CREATE item
  for i in $(seq 0 $((count - 1))); do
    item=$(jq ".actions.create[$i]" "$plan_file")
    device_name=$(echo "$item" | jq -r '.deviceName')
    tb_id=$(echo "$item"       | jq -r '.tbId')

    # Build fields from tb block
    asset_id=$(echo "$item"      | jq -r '.tb.gcdrAssetId  // ""')
    # Fall back to DEFAULT_GCDR_ASSET_ID from config.env when assetId is empty
    [[ -z "$asset_id" && -n "${DEFAULT_GCDR_ASSET_ID:-}" ]] && asset_id="$DEFAULT_GCDR_ASSET_ID"
    central_id=$(echo "$item"    | jq -r '.tb.centralId    // ""')
    slave_id=$(echo "$item"      | jq -r '.tb.slaveId      // ""')
    label=$(echo "$item"         | jq -r '.tb.label        // ""')
    identifier=$(echo "$item"    | jq -r '.tb.identifier   // ""')
    device_type=$(echo "$item"   | jq -r '.tb.deviceType   // "OTHER"')
    device_profile=$(echo "$item"| jq -r '.tb.deviceProfile // ""')
    customer_id=$(echo "$item"   | jq -r '.tb.gcdrCustomerId // ""')

    # Build POST body
    BODY=$(jq -n \
      --arg assetId      "$asset_id" \
      --arg customerId   "$customer_id" \
      --arg name         "$device_name" \
      --arg displayName  "$label" \
      --arg label        "$label" \
      --arg type         "METER" \
      --arg externalId   "$tb_id" \
      --arg identifier   "$identifier" \
      --arg deviceProfile "$device_profile" \
      --arg deviceType   "$device_type" \
      --arg centralId    "$central_id" \
      --argjson slaveId  "$(echo "$slave_id" | grep -qE '^[0-9]+$' && echo "$slave_id" || echo 'null')" \
      '{
        assetId: $assetId,
        customerId: $customerId,
        name: $name,
        displayName: $displayName,
        label: $label,
        type: $type,
        externalId: $externalId,
        identifier: $identifier,
        deviceProfile: $deviceProfile,
        deviceType: $deviceType,
        centralId: $centralId,
        slaveId: $slaveId,
        credentials: { type: "ACCESS_TOKEN" },
        telemetryConfig: { attributeKeys: [], telemetryKeys: [], reportingInterval: 60 },
        metadata: { tbId: $externalId, source: "consolidate-creates" }
      }')

    if [[ "$DRY_RUN" == "true" ]]; then
      echo -e "  ${YELLOW}[DRY-RUN]${NC} $device_name"
      echo "$BODY" | jq .
      echo "|$asset_id|$central_id|$slave_id|$device_name|$label|$tb_id" >> "$OUT_FILE"
      continue
    fi

    echo -e "  → Creating: ${BOLD}$device_name${NC}"
    RESP=$(gcdr_post "/devices" "$BODY")
    SUCCESS=$(echo "$RESP" | jq -r '.success // false')

    if [[ "$SUCCESS" == "true" ]]; then
      gcdr_id=$(echo "$RESP" | jq -r '.data.id')
      echo -e "  ${GREEN}[OK]${NC}   gcdrDeviceId=$gcdr_id"
      echo "$gcdr_id|$asset_id|$central_id|$slave_id|$device_name|$label|$tb_id" >> "$OUT_FILE"
      TOTAL_OK=$((TOTAL_OK + 1))
    else
      err_msg=$(echo "$RESP" | jq -r '.error.message // .message // "unknown error"')
      err_details=$(echo "$RESP" | jq -r '.error.details // {} | to_entries | map("\(.key): \(.value[0])") | join(", ")' 2>/dev/null || true)
      echo -e "  ${RED}[FAIL]${NC} $device_name — $err_msg${err_details:+ ($err_details)}"
      echo "# FAILED $device_name|$asset_id|$central_id|$slave_id|$device_name|$label|$tb_id|ERROR: $err_msg" >> "$OUT_FILE"
      TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
  done
  echo ""
done

echo -e "${BOLD}=== done ===${NC}"
if [[ "$DRY_RUN" == "false" ]]; then
  echo -e "  ${GREEN}Created${NC}: $TOTAL_OK"
  [[ $TOTAL_FAIL -gt 0 ]] && echo -e "  ${RED}Failed${NC} : $TOTAL_FAIL"
fi
echo -e "  Output : ${CYAN}$(basename "$OUT_FILE")${NC}"
echo ""

[[ $TOTAL_FAIL -gt 0 ]] && exit 2
exit 0
