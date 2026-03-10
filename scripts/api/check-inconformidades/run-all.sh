#!/bin/bash
# =============================================================================
# run-all.sh
# Runs check-inconformidades.sh sequentially for every device-map-*.txt file.
#
# Usage:
#   ./run-all.sh
#   ./run-all.sh --auth jwt
#   GCDR_API_URL=http://localhost:3015 ./run-all.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS_THROUGH_ARGS=("$@")

FILES=("$SCRIPT_DIR"/device-map-*.txt)

if [[ ${#FILES[@]} -eq 0 || ! -f "${FILES[0]}" ]]; then
  echo -e "${RED}[FAIL]${NC} No device-map-*.txt files found in $SCRIPT_DIR"
  exit 1
fi

TOTAL_FILES=${#FILES[@]}
COUNT_OK=0
COUNT_WARN=0
COUNT_FAIL=0

echo -e "\n${BOLD}=== run-all: $TOTAL_FILES file(s) to process ===${NC}\n"

for filepath in "${FILES[@]}"; do
  filename="$(basename "$filepath")"
  echo -e "${BOLD}──────────────────────────────────────────────${NC}"
  echo -e "${CYAN}▶ $filename${NC}"
  echo -e "${BOLD}──────────────────────────────────────────────${NC}"

  set +e
  "$SCRIPT_DIR/check-inconformidades.sh" --file "$filename" "${PASS_THROUGH_ARGS[@]}"
  EXIT_CODE=$?
  set -e

  case $EXIT_CODE in
    0) echo -e "${GREEN}[DONE]${NC} $filename — all conformant (or empty)\n"; COUNT_OK=$((COUNT_OK + 1)) ;;
    2) echo -e "${YELLOW}[DONE]${NC} $filename — divergences found\n";       COUNT_WARN=$((COUNT_WARN + 1)) ;;
    *) echo -e "${RED}[ERROR]${NC} $filename — fatal error (exit $EXIT_CODE)\n"; COUNT_FAIL=$((COUNT_FAIL + 1)) ;;
  esac
done

echo -e "${BOLD}=== run-all complete ===${NC}"
echo -e "  ${GREEN}All conformant${NC} : $COUNT_OK"
echo -e "  ${YELLOW}With divergences${NC}: $COUNT_WARN"
echo -e "  ${RED}Errors${NC}          : $COUNT_FAIL"
echo ""

[[ $COUNT_FAIL -gt 0 ]] && exit 1
[[ $COUNT_WARN -gt 0 ]] && exit 2
exit 0
