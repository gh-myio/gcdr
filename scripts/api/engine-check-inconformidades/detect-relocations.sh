#!/bin/bash
# =============================================================================
# detect-relocations.sh
# Reads all action-plan-*.json, inspects each CREATE item, and queries GCDR
# to detect devices that already exist under the wrong customer.
#
# For each CREATE whose externalId (tbId) or central+slaveId already exists
# in GCDR under a different customer, emits a RELOCATE action.
#
# Output: customers/<name>/relocation-plan-<timestamp>.json
#
# Usage:
#   ./detect-relocations.sh --customer montserrat
#   GCDR_API_URL=http://localhost:3015 ./detect-relocations.sh --customer mestre-alvaro
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOMER_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --customer) CUSTOMER_NAME="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[[ -z "$CUSTOMER_NAME" ]] && { echo "[FAIL] --customer <name> is required"; exit 1; }
CUSTOMER_DIR="$SCRIPT_DIR/customers/$CUSTOMER_NAME"
[[ ! -d "$CUSTOMER_DIR" ]] && { echo "[FAIL] Customer directory not found: $CUSTOMER_DIR"; exit 1; }

# Load local config
[[ -f "$CUSTOMER_DIR/config.env" ]] && source "$CUSTOMER_DIR/config.env"

API_URL="${GCDR_API_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_myio_tenant_bundle_key_2026}"
TARGET_CUSTOMER_ID="${GCDR_CUSTOMER_ID:-}"
DEFAULT_ASSET_ID="${DEFAULT_GCDR_ASSET_ID:-}"
OUT_FILE="$CUSTOMER_DIR/relocation-plan-$(date +%Y%m%d-%H%M%S).json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()    { echo -e "${RED}[FAIL]${NC} $*"; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Required: '$1' not found."; exit 1; }; }
require_cmd curl
require_cmd jq

[[ -z "$TARGET_CUSTOMER_ID" ]] && { fail "GCDR_CUSTOMER_ID not set in config.env"; exit 1; }

PLANS=("$CUSTOMER_DIR"/action-plan-*.json)
if [[ ${#PLANS[@]} -eq 0 || ! -f "${PLANS[0]}" ]]; then
  fail "No action-plan-*.json found in $CUSTOMER_DIR"
  exit 1
fi

echo -e "\n${BOLD}=== detect-relocations [$CUSTOMER_NAME]: ${#PLANS[@]} plan(s) ===${NC}"
echo -e "  Target customer: ${CYAN}$TARGET_CUSTOMER_ID${NC}\n"

RESULTS_FILE=$(mktemp /tmp/gcdr_relocations_XXXXXX.ndjson)
: > "$RESULTS_FILE"
trap 'rm -f "$RESULTS_FILE"' EXIT

gcdr_get() {
  curl -s "$API_URL/api/v1$1" \
    -H "X-API-Key: $API_KEY" \
    -H "Accept: application/json"
}

TOTAL_RELOCATE=0
TOTAL_OK=0

for plan_file in "${PLANS[@]}"; do
  plan_name="$(basename "$plan_file" .json)"
  count=$(jq '.actions.create | length' "$plan_file")
  [[ "$count" -eq 0 ]] && continue

  echo -e "${CYAN}▶ $(basename "$plan_file")${NC} — $count CREATE(s) to inspect"

  for i in $(seq 0 $((count - 1))); do
    item=$(jq ".actions.create[$i]" "$plan_file")
    device_name=$(echo "$item" | jq -r '.deviceName')
    tb_id=$(echo "$item"       | jq -r '.tbId // ""')
    central_id=$(echo "$item"  | jq -r '.tb.centralId // ""')
    slave_id=$(echo "$item"    | jq -r '.tb.slaveId // ""')

    found_id=""
    found_customer=""
    found_asset=""
    match_method=""

    # --- Lookup 1: by externalId (tbId) ---
    if [[ -n "$tb_id" ]]; then
      resp=$(gcdr_get "/devices?externalId=$tb_id")
      found_id=$(echo "$resp"       | jq -r '.data.items[0].id          // ""')
      found_customer=$(echo "$resp" | jq -r '.data.items[0].customerId   // ""')
      found_asset=$(echo "$resp"    | jq -r '.data.items[0].assetId      // ""')
      [[ -n "$found_id" ]] && match_method="externalId"
    fi

    # --- Lookup 2: by centralId+slaveId ---
    if [[ -z "$found_id" && -n "$central_id" && -n "$slave_id" ]]; then
      resp=$(gcdr_get "/devices?centralId=$central_id&slaveId=$slave_id")
      found_id=$(echo "$resp"       | jq -r '.data.items[0].id          // ""')
      found_customer=$(echo "$resp" | jq -r '.data.items[0].customerId   // ""')
      found_asset=$(echo "$resp"    | jq -r '.data.items[0].assetId      // ""')
      [[ -n "$found_id" ]] && match_method="centralId+slaveId"
    fi

    if [[ -z "$found_id" ]]; then
      ok "  $device_name → not found in GCDR (genuine CREATE)"
      TOTAL_OK=$((TOTAL_OK + 1))
      continue
    fi

    if [[ "$found_customer" == "$TARGET_CUSTOMER_ID" ]]; then
      ok "  $device_name → already in correct customer"
      TOTAL_OK=$((TOTAL_OK + 1))
      continue
    fi

    warn "  $device_name → found in wrong customer!"
    echo "    gcdrDeviceId  : $found_id"
    echo "    currentCustomer: $found_customer"
    echo "    targetCustomer : $TARGET_CUSTOMER_ID"
    echo "    matchMethod    : $match_method"

    # Determine target assetId: keep existing if in same scope, else use default
    target_asset="$DEFAULT_ASSET_ID"
    [[ -z "$target_asset" ]] && target_asset="$found_asset"

    jq -n \
      --arg gcdrDeviceId    "$found_id" \
      --arg deviceName      "$device_name" \
      --arg tbId            "$tb_id" \
      --arg currentCustomer "$found_customer" \
      --arg targetCustomer  "$TARGET_CUSTOMER_ID" \
      --arg currentAsset    "$found_asset" \
      --arg targetAsset     "$target_asset" \
      --arg matchMethod     "$match_method" \
      --arg sourcePlan      "$(basename "$plan_file")" \
      '{
        action: "RELOCATE",
        gcdrDeviceId: $gcdrDeviceId,
        deviceName: $deviceName,
        tbId: $tbId,
        matchMethod: $matchMethod,
        sourcePlan: $sourcePlan,
        currentCustomerId: $currentCustomer,
        targetCustomerId: $targetCustomer,
        currentAssetId: $currentAsset,
        targetAssetId: $targetAsset
      }' >> "$RESULTS_FILE"

    TOTAL_RELOCATE=$((TOTAL_RELOCATE + 1))
  done
  echo ""
done

# Build output JSON
RESULTS_ARRAY=$(jq -s '.' "$RESULTS_FILE")

jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg targetCustomer "$TARGET_CUSTOMER_ID" \
  --argjson items "$RESULTS_ARRAY" \
  '{
    meta: {
      generatedAt: $generatedAt,
      targetCustomerId: $targetCustomer,
      summary: {
        relocate: ($items | length),
        genuineCreates: '"$TOTAL_OK"'
      }
    },
    actions: {
      relocate: $items
    }
  }' > "$OUT_FILE"

echo -e "${BOLD}=== done ===${NC}"
echo -e "  ${YELLOW}Relocate${NC} : $TOTAL_RELOCATE"
echo -e "  ${GREEN}OK/New${NC}   : $TOTAL_OK"
echo -e "  Plan     : ${CYAN}$(basename "$OUT_FILE")${NC}"
echo ""

[[ $TOTAL_RELOCATE -gt 0 ]] && exit 2
exit 0
