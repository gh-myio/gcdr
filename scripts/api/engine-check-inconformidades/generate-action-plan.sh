#!/bin/bash
# =============================================================================
# generate-action-plan.sh
# Reads all inconformidades-report-device-map-*.json files and generates
# one action-plan-*.json per report.
#
# Actions:
#   CREATE  — device NOT_LINKED in GCDR (needs to be created)
#   UPDATE  — device DIVERGENT in GCDR (needs to be updated)
#   SKIP    — device CONFORMANT (no action required)
#
# Each action item includes a pipe-delimited line:
#   gcdrDeviceId|assetGcdrId|central_id|slave_id|name|display_name|tb_id
#
# Usage:
#   ./generate-action-plan.sh --customer montserrat
#   ./generate-action-plan.sh --customer mestre-alvaro --reports-dir /path/to/reports
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUSTOMER_NAME=""
REPORTS_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --customer)    CUSTOMER_NAME="$2"; shift 2 ;;
    --reports-dir) REPORTS_DIR="$2";   shift 2 ;;
    *) shift ;;
  esac
done

[[ -z "$CUSTOMER_NAME" ]] && { echo "[FAIL] --customer <name> is required"; exit 1; }
CUSTOMER_DIR="$SCRIPT_DIR/customers/$CUSTOMER_NAME"
[[ ! -d "$CUSTOMER_DIR" ]] && { echo "[FAIL] Customer directory not found: $CUSTOMER_DIR"; exit 1; }

# Load local config
[[ -f "$CUSTOMER_DIR/config.env" ]] && source "$CUSTOMER_DIR/config.env"

# Default reports dir to customer dir if not overridden
[[ -z "$REPORTS_DIR" ]] && REPORTS_DIR="$CUSTOMER_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Required: '$1' not found."; exit 1; }; }
require_cmd jq

# ---------------------------------------------------------------------------
# Locate report files
# ---------------------------------------------------------------------------
REPORTS=("$REPORTS_DIR"/inconformidades-report-device-map-*.json)

if [[ ${#REPORTS[@]} -eq 0 || ! -f "${REPORTS[0]}" ]]; then
  echo -e "${RED}[FAIL]${NC} No inconformidades-report-device-map-*.json found in $REPORTS_DIR"
  exit 1
fi

echo -e "\n${BOLD}=== generate-action-plan [$CUSTOMER_NAME]: ${#REPORTS[@]} report(s) ===${NC}\n"

for report_file in "${REPORTS[@]}"; do
  report_name="$(basename "$report_file" .json)"
  # Replace "inconformidades-report-" prefix with "action-plan-"
  plan_name="${report_name/inconformidades-report-/action-plan-}"
  plan_file="$CUSTOMER_DIR/${plan_name}.json"

  echo -e "${CYAN}▶ $report_name${NC}"

  jq --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     --arg sourceReport "$(basename "$report_file")" '
    def line(r):
      # CREATE: gcdrDeviceId is empty — GCDR will assign on insert
      # UPDATE: use the confirmed gcdr.id
      ( if (r.gcdr != null and r.gcdr.id != null and r.gcdr.id != "")
        then r.gcdr.id
        else ""
        end
      ) as $gcdrDeviceId |
      (r.gcdr.assetId   // r.tb.gcdrAssetId  // "") as $assetGcdrId  |
      (r.gcdr.centralId // r.tb.centralId    // "") as $centralId    |
      ( (r.gcdr.slaveId // r.tb.slaveId // "") | tostring ) as $slaveId |
      (r.gcdr.name      // r.deviceName      // "") as $name         |
      (r.gcdr.displayName // r.tb.label      // "") as $displayName  |
      r.tbId as $tbId |
      "\($gcdrDeviceId)|\($assetGcdrId)|\($centralId)|\($slaveId)|\($name)|\($displayName)|\($tbId)";

    # Returns true if the only divergence is "identifier: ..."
    def only_identifier_divergence:
      (.divergences | length) == 1 and (.divergences[0] | startswith("identifier:"));

    def make_item(r; action):
      if action == "CREATE" then
        { action: action, line: line(r), tbId: r.tbId, deviceName: r.deviceName,
          divergences: (r.divergences // []), tb: r.tb, gcdr: r.gcdr }
      elif action == "UPDATE_IDENTIFIER" then
        { action: action, tbId: r.tbId, deviceName: r.deviceName,
          gcdrDeviceId: (r.gcdr.id // r.tb.gcdrDeviceId // ""),
          identifierTb: r.tb.identifier, identifierGcdr: r.gcdr.identifier,
          tb: r.tb, gcdr: r.gcdr }
      else
        { action: action, tbId: r.tbId, deviceName: r.deviceName,
          gcdrDeviceId: (r.gcdr.id // r.tb.gcdrDeviceId // ""),
          divergences: (r.divergences // []), tb: r.tb, gcdr: r.gcdr }
      end;

    {
      meta: {
        generatedAt:  $generatedAt,
        sourceReport: $sourceReport,
        summary: {
          create:            ([.results[] | select(.status == "NOT_LINKED")] | length),
          update:            ([.results[] | select(.status == "DIVERGENT" and (only_identifier_divergence | not))] | length),
          update_identifier: ([.results[] | select(.status == "DIVERGENT" and only_identifier_divergence)] | length),
          skip:              ([.results[] | select(.status == "CONFORMANT")] | length)
        }
      },
      actions: {
        create:            [.results[] | select(.status == "NOT_LINKED") | make_item(.; "CREATE")],
        update:            [.results[] | select(.status == "DIVERGENT" and (only_identifier_divergence | not)) | make_item(.; "UPDATE")],
        update_identifier: [.results[] | select(.status == "DIVERGENT" and only_identifier_divergence) | make_item(.; "UPDATE_IDENTIFIER")],
        skip:              [.results[] | select(.status == "CONFORMANT") | make_item(.; "SKIP")]
      }
    }
  ' "$report_file" > "$plan_file"

  CREATE=$(jq '.meta.summary.create'            "$plan_file")
  UPDATE=$(jq '.meta.summary.update'            "$plan_file")
  UPDATE_ID=$(jq '.meta.summary.update_identifier' "$plan_file")
  SKIP=$(jq  '.meta.summary.skip'              "$plan_file")

  echo -e "  ${GREEN}create${NC}: $CREATE  ${YELLOW}update${NC}: $UPDATE  update_identifier: $UPDATE_ID  skip: $SKIP"
  echo -e "  → ${CYAN}$(basename "$plan_file")${NC}\n"
done

echo -e "${BOLD}=== done ===${NC}"
