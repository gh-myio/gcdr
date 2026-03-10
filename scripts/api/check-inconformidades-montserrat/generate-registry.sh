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
#   ./generate-registry.sh
#   ./generate-registry.sh --out my-registry.txt
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

OUT_FILE="$SCRIPT_DIR/device-registry-$(date +%Y%m%d-%H%M%S).txt"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_FILE="$SCRIPT_DIR/$2"; shift 2 ;;
    *) shift ;;
  esac
done

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Required: '$1' not found."; exit 1; }; }
require_cmd jq

PLANS=("$SCRIPT_DIR"/action-plan-*.json)
if [[ ! -f "${PLANS[0]}" ]]; then
  echo -e "${RED}[FAIL]${NC} No action-plan-*.json found in $SCRIPT_DIR"
  exit 1
fi

echo -e "\n${BOLD}=== generate-registry: ${#PLANS[@]} plan(s) ===${NC}\n"

# Header
echo "gcdrId|parentAssetGcdrId|central_id|slave_id|name|display_name|tb_id" > "$OUT_FILE"

# Extract one row per device from skip + update + update_identifier sections.
# Deduplicate by gcdrId (sort -u on the whole line).
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

echo -e "${GREEN}[OK]${NC}  $TOTAL device(s) written → $(basename "$OUT_FILE")"
echo ""
