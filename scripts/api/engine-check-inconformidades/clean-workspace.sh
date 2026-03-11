#!/bin/bash
# =============================================================================
# clean-workspace.sh
# Deletes generated files: reports, action-plans, relocation-plans, apply-logs.
# Device-map files and config.env are NOT touched.
#
# Usage:
#   ./clean-workspace.sh                        (clean all customers, interactive)
#   ./clean-workspace.sh --customer montserrat  (only one customer)
#   ./clean-workspace.sh --force                (skip confirmation)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE=false
CUSTOMER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)    FORCE=true;     shift ;;
    --customer) CUSTOMER="$2";  shift 2 ;;
    *) shift ;;
  esac
done

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Determine search dirs
if [[ -n "$CUSTOMER" ]]; then
  SEARCH_DIRS=("$SCRIPT_DIR/customers/$CUSTOMER")
  if [[ ! -d "${SEARCH_DIRS[0]}" ]]; then
    echo -e "${RED}[ERROR]${NC} Customer folder not found: ${SEARCH_DIRS[0]}"
    exit 1
  fi
else
  SEARCH_DIRS=("$SCRIPT_DIR/customers"/*)
fi

# Collect files
declare -a TO_DELETE=()
for dir in "${SEARCH_DIRS[@]}"; do
  [[ ! -d "$dir" ]] && continue
  for pattern in \
    "$dir"/inconformidades-report-*.json \
    "$dir"/action-plan-*.json \
    "$dir"/relocation-plan-*.json \
    "$dir"/apply-updates-*.log \
    "$dir"/consolidated-creates-*.txt \
    "$dir"/device-registry-*.txt
  do
    for f in $pattern; do
      [[ -f "$f" ]] && TO_DELETE+=("$f")
    done
  done
done

COUNT=${#TO_DELETE[@]}

if [[ $COUNT -eq 0 ]]; then
  echo -e "${GREEN}[OK]${NC} Nothing to clean."
  exit 0
fi

echo -e "\n${BOLD}=== clean-workspace ===${NC}"
[[ -n "$CUSTOMER" ]] && echo -e "  Customer: ${YELLOW}$CUSTOMER${NC}"
echo -e "  Found ${YELLOW}$COUNT${NC} file(s) to delete:\n"

for f in "${TO_DELETE[@]}"; do
  # Show relative path from SCRIPT_DIR
  echo -e "  ${RED}✗${NC} ${f#$SCRIPT_DIR/}"
done

echo ""

if [[ "$FORCE" == "false" ]]; then
  read -rp "Delete all? [y/N] " CONFIRM
  [[ "${CONFIRM,,}" != "y" ]] && echo "Aborted." && exit 0
fi

for f in "${TO_DELETE[@]}"; do
  rm -f "$f"
done

echo -e "${GREEN}[OK]${NC} Deleted $COUNT file(s)."
