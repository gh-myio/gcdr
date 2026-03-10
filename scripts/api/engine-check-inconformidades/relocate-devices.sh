#!/bin/bash
# =============================================================================
# relocate-devices.sh
# Reads the latest relocation-plan-*.json and patches each RELOCATE device
# in GCDR with the correct customerId (and assetId when available).
#
# Usage:
#   ./relocate-devices.sh --customer montserrat
#   ./relocate-devices.sh --customer mestre-alvaro --dry-run
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOMER_NAME=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --customer) CUSTOMER_NAME="$2"; shift 2 ;;
    --dry-run)  DRY_RUN=true; shift ;;
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

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Required: '$1' not found."; exit 1; }; }
require_cmd curl
require_cmd jq

# Pick the latest relocation-plan file
PLAN_FILE=$(ls -t "$CUSTOMER_DIR"/relocation-plan-*.json 2>/dev/null | head -1 || true)
if [[ -z "$PLAN_FILE" || ! -f "$PLAN_FILE" ]]; then
  echo -e "${RED}[FAIL]${NC} No relocation-plan-*.json found. Run detect-relocations.sh --customer $CUSTOMER_NAME first."
  exit 1
fi

count=$(jq '.actions.relocate | length' "$PLAN_FILE")
if [[ "$count" -eq 0 ]]; then
  echo -e "${GREEN}[OK]${NC} No relocations needed."
  exit 0
fi

echo -e "\n${BOLD}=== relocate-devices [$CUSTOMER_NAME]: $count item(s) | dry-run=$DRY_RUN ===${NC}"
echo -e "  Plan: ${CYAN}$(basename "$PLAN_FILE")${NC}\n"

TOTAL_OK=0
TOTAL_FAIL=0

for i in $(seq 0 $((count - 1))); do
  item=$(jq ".actions.relocate[$i]" "$PLAN_FILE")
  gcdr_id=$(echo "$item"     | jq -r '.gcdrDeviceId')
  device_name=$(echo "$item" | jq -r '.deviceName')
  target_customer=$(echo "$item" | jq -r '.targetCustomerId')
  target_asset=$(echo "$item"    | jq -r '.targetAssetId // ""')

  if [[ -z "$target_asset" ]]; then
    echo -e "${RED}[FAIL]${NC} $device_name — targetAssetId is required for /move"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    continue
  fi

  BODY=$(jq -n \
    --arg newAssetId    "$target_asset" \
    --arg newCustomerId "$target_customer" \
    '{newAssetId: $newAssetId, newCustomerId: $newCustomerId}')

  if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${CYAN}[DRY-RUN]${NC} $device_name ($gcdr_id)"
    echo -e "          POST /devices/$gcdr_id/move  → customer=$target_customer"
    echo -e "          body: $(echo "$BODY" | jq -c .)"
    TOTAL_OK=$((TOTAL_OK + 1))
    continue
  fi

  RESP=$(curl -s -X POST "$API_URL/api/v1/devices/$gcdr_id/move" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$BODY")

  SUCCESS=$(echo "$RESP" | jq -r '.success // false')

  if [[ "$SUCCESS" == "true" ]]; then
    new_customer=$(echo "$RESP" | jq -r '.data.customerId // ""')
    echo -e "${GREEN}[OK]${NC}   $device_name → customerId=$new_customer"
    TOTAL_OK=$((TOTAL_OK + 1))
  else
    err=$(echo "$RESP" | jq -r '.error.message // .message // "unknown error"')
    echo -e "${RED}[FAIL]${NC} $device_name — $err"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
done

echo -e "\n${BOLD}=== done ===${NC}"
echo -e "  ${GREEN}OK${NC}   : $TOTAL_OK"
[[ $TOTAL_FAIL -gt 0 ]] && echo -e "  ${RED}FAIL${NC} : $TOTAL_FAIL"
echo ""

[[ $TOTAL_FAIL -gt 0 ]] && exit 2
exit 0
