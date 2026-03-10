#!/bin/bash
# =============================================================================
# generate-registry.sh
# Reads all action-plan-*.json files and produces a consolidated device
# registry with GCDR-side identifiers for every device that already exists
# in GCDR (actions: SKIP, UPDATE, UPDATE_IDENTIFIER).
#
# CREATE actions (not yet in GCDR) are excluded — run consolidate-creates.sh
# first, then re-run run-all.sh to include them in the registry.
#
# Output columns (pipe-delimited):
#   gcdrId | parentAssetGcdrId | central_id | slave_id | name | display_name | tb_id
#
# Usage:
#   ./generate-registry.sh --customer montserrat
#   ./generate-registry.sh --customer mestre-alvaro --out my-registry.txt
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOMER_NAME=""

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --customer) CUSTOMER_NAME="$2"; shift 2 ;;
    --out)      OUT_OVERRIDE="$2";  shift 2 ;;
    *) shift ;;
  esac
done

[[ -z "$CUSTOMER_NAME" ]] && { echo "[FAIL] --customer <name> is required"; exit 1; }
CUSTOMER_DIR="$SCRIPT_DIR/customers/$CUSTOMER_NAME"
[[ ! -d "$CUSTOMER_DIR" ]] && { echo "[FAIL] Customer directory not found: $CUSTOMER_DIR"; exit 1; }

OUT_FILE="${OUT_OVERRIDE:-$CUSTOMER_DIR/device-registry-$(date +%Y%m%d-%H%M%S).txt}"
[[ -n "${OUT_OVERRIDE:-}" ]] && OUT_FILE="$CUSTOMER_DIR/$OUT_OVERRIDE"

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Required: '$1' not found."; exit 1; }; }
require_cmd jq

PLANS=("$CUSTOMER_DIR"/action-plan-*.json)
if [[ ! -f "${PLANS[0]}" ]]; then
  echo -e "${RED}[FAIL]${NC} No action-plan-*.json found in $CUSTOMER_DIR"
  exit 1
fi

echo -e "\n${BOLD}=== generate-registry [$CUSTOMER_NAME]: ${#PLANS[@]} plan(s) ===${NC}\n"

# Header
echo "gcdrId|parentAssetGcdrId|central_id|slave_id|name|display_name|tb_id" > "$OUT_FILE"

{
  for plan in "${PLANS[@]}"; do
    jq -r '
      .actions |
      [ (.skip          // []),
        (.update         // []),
        (.update_identifier // []) ] |
      flatten |
      .[] |
      select(.gcdr != null) |
      [
        .gcdrDeviceId,
        (.gcdr.assetId    // ""),
        (.gcdr.centralId  // ""),
        ((.gcdr.slaveId   // "") | tostring),
        (.gcdr.name       // ""),
        (.gcdr.displayName // .gcdr.label // ""),
        (.tbId            // "")
      ] | join("|")
    ' "$plan"
  done
} | sort -u >> "$OUT_FILE"

TOTAL=$(( $(wc -l < "$OUT_FILE") - 1 ))

echo -e "${GREEN}[OK]${NC}  $TOTAL device(s) written → ${OUT_FILE#$SCRIPT_DIR/}"
echo ""
