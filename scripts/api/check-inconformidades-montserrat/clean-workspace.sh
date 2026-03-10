#!/bin/bash
# =============================================================================
# clean-workspace.sh
# Deletes generated files: reports, action-plans, relocation-plans, apply-logs.
# Device-map files and config.env are NOT touched.
#
# Usage:
#   ./clean-workspace.sh           (interactive confirmation)
#   ./clean-workspace.sh --force   (skip confirmation)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE=false

[[ "${1:-}" == "--force" ]] && FORCE=true

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Files to delete
FILES=(
  "$SCRIPT_DIR"/inconformidades-report-*.json
  "$SCRIPT_DIR"/action-plan-*.json
  "$SCRIPT_DIR"/relocation-plan-*.json
  "$SCRIPT_DIR"/apply-updates-*.log
  "$SCRIPT_DIR"/consolidated-creates-*.txt
)

# Count how many exist
COUNT=0
for pattern in "${FILES[@]}"; do
  for f in $pattern; do
    [[ -f "$f" ]] && COUNT=$((COUNT + 1))
  done
done

if [[ $COUNT -eq 0 ]]; then
  echo -e "${GREEN}[OK]${NC} Nothing to clean."
  exit 0
fi

echo -e "\n${BOLD}=== clean-workspace ===${NC}"
echo -e "  Found ${YELLOW}$COUNT${NC} file(s) to delete:\n"

for pattern in "${FILES[@]}"; do
  for f in $pattern; do
    [[ -f "$f" ]] && echo -e "  ${RED}✗${NC} $(basename "$f")"
  done
done

echo ""

if [[ "$FORCE" == "false" ]]; then
  read -rp "Delete all? [y/N] " CONFIRM
  [[ "${CONFIRM,,}" != "y" ]] && echo "Aborted." && exit 0
fi

DELETED=0
for pattern in "${FILES[@]}"; do
  for f in $pattern; do
    if [[ -f "$f" ]]; then
      rm -f "$f"
      DELETED=$((DELETED + 1))
    fi
  done
done

echo -e "${GREEN}[OK]${NC} Deleted $DELETED file(s)."
