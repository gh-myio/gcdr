#!/bin/bash
# =============================================================================
# run-all.sh
# Full pipeline for a customer directory:
#   Step 1 — check-inconformidades.sh × N device-map files  → reports
#   Step 2 — generate-action-plan.sh                        → action-plans
#   Step 3 — detect-relocations.sh                          → relocation-plan
#
# Usage:
#   ./run-all.sh --customer montserrat
#   ./run-all.sh --customer mestre-alvaro --auth jwt
#   ./run-all.sh --customer montserrat --checks-only      (skip steps 2 and 3)
#   GCDR_API_URL=http://localhost:3015 ./run-all.sh --customer montserrat
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOMER_NAME=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

CHECKS_ONLY=false
PASS_THROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --customer)    CUSTOMER_NAME="$2"; shift 2 ;;
    --checks-only) CHECKS_ONLY=true; shift ;;
    *) PASS_THROUGH_ARGS+=("$1"); shift ;;
  esac
done

[[ -z "$CUSTOMER_NAME" ]] && { echo -e "${RED}[FAIL]${NC} --customer <name> is required"; exit 1; }
CUSTOMER_DIR="$SCRIPT_DIR/customers/$CUSTOMER_NAME"
[[ ! -d "$CUSTOMER_DIR" ]] && { echo -e "${RED}[FAIL]${NC} Customer directory not found: $CUSTOMER_DIR"; exit 1; }

FILES=("$CUSTOMER_DIR"/device-map-*.txt)

if [[ ${#FILES[@]} -eq 0 || ! -f "${FILES[0]}" ]]; then
  echo -e "${RED}[FAIL]${NC} No device-map-*.txt files found in $CUSTOMER_DIR"
  exit 1
fi

TOTAL_FILES=${#FILES[@]}
COUNT_OK=0
COUNT_WARN=0
COUNT_FAIL=0

echo -e "\n${BOLD}=== run-all [$CUSTOMER_NAME]: $TOTAL_FILES file(s) to process ===${NC}\n"

for filepath in "${FILES[@]}"; do
  filename="$(basename "$filepath")"
  echo -e "${BOLD}──────────────────────────────────────────────${NC}"
  echo -e "${CYAN}▶ $filename${NC}"
  echo -e "${BOLD}──────────────────────────────────────────────${NC}"

  set +e
  "$SCRIPT_DIR/check-inconformidades.sh" --customer "$CUSTOMER_NAME" --file "$filename" "${PASS_THROUGH_ARGS[@]}"
  EXIT_CODE=$?
  set -e

  case $EXIT_CODE in
    0) echo -e "${GREEN}[DONE]${NC} $filename — all conformant (or empty)\n"; COUNT_OK=$((COUNT_OK + 1)) ;;
    2) echo -e "${YELLOW}[DONE]${NC} $filename — divergences found\n";       COUNT_WARN=$((COUNT_WARN + 1)) ;;
    *) echo -e "${RED}[ERROR]${NC} $filename — fatal error (exit $EXIT_CODE)\n"; COUNT_FAIL=$((COUNT_FAIL + 1)) ;;
  esac
done

echo -e "${BOLD}=== Step 1 complete ===${NC}"
echo -e "  ${GREEN}All conformant${NC} : $COUNT_OK"
echo -e "  ${YELLOW}With divergences${NC}: $COUNT_WARN"
echo -e "  ${RED}Errors${NC}          : $COUNT_FAIL"
echo ""

[[ $COUNT_FAIL -gt 0 ]] && exit 1

if [[ "$CHECKS_ONLY" == "true" ]]; then
  [[ $COUNT_WARN -gt 0 ]] && exit 2
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 2 — generate-action-plan.sh
# ---------------------------------------------------------------------------
echo -e "${BOLD}──────────────────────────────────────────────${NC}"
echo -e "${BOLD}Step 2 — Generating action plans${NC}"
echo -e "${BOLD}──────────────────────────────────────────────${NC}"
set +e
"$SCRIPT_DIR/generate-action-plan.sh" --customer "$CUSTOMER_NAME"
AP_EXIT=$?
set -e
[[ $AP_EXIT -ne 0 ]] && echo -e "${RED}[ERROR]${NC} generate-action-plan.sh failed (exit $AP_EXIT)" && exit 1

# ---------------------------------------------------------------------------
# Step 3 — detect-relocations.sh
# ---------------------------------------------------------------------------
echo -e "${BOLD}──────────────────────────────────────────────${NC}"
echo -e "${BOLD}Step 3 — Detecting wrong-customer devices${NC}"
echo -e "${BOLD}──────────────────────────────────────────────${NC}"
set +e
"$SCRIPT_DIR/detect-relocations.sh" --customer "$CUSTOMER_NAME"
DR_EXIT=$?
set -e
if [[ $DR_EXIT -eq 2 ]]; then
  echo -e "${YELLOW}[WARN]${NC} Devices found in wrong customer — run ./relocate-devices.sh --customer $CUSTOMER_NAME to fix."
elif [[ $DR_EXIT -ne 0 ]]; then
  echo -e "${RED}[ERROR]${NC} detect-relocations.sh failed (exit $DR_EXIT)"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 4 — generate-registry.sh
# ---------------------------------------------------------------------------
echo -e "${BOLD}──────────────────────────────────────────────${NC}"
echo -e "${BOLD}Step 4 — Generating device registry${NC}"
echo -e "${BOLD}──────────────────────────────────────────────${NC}"
set +e
"$SCRIPT_DIR/generate-registry.sh" --customer "$CUSTOMER_NAME"
GR_EXIT=$?
set -e
[[ $GR_EXIT -ne 0 ]] && echo -e "${YELLOW}[WARN]${NC} generate-registry.sh failed (non-fatal)"

echo ""
echo -e "${BOLD}=== run-all complete ===${NC}"
echo -e "  Next: review action plans, then run:"
echo -e "  ${CYAN}./relocate-devices.sh --customer $CUSTOMER_NAME --dry-run${NC}   (fix wrong-customer devices)"
echo -e "  ${CYAN}./consolidate-creates.sh --customer $CUSTOMER_NAME --dry-run${NC} (create new devices)"
echo -e "  ${CYAN}./apply-updates.sh --customer $CUSTOMER_NAME --dry-run${NC}       (patch divergent fields)"
echo ""

[[ $COUNT_WARN -gt 0 || $DR_EXIT -eq 2 ]] && exit 2
exit 0
