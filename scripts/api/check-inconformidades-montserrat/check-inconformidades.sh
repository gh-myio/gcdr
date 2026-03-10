#!/bin/bash
# =============================================================================
# check-inconformidades.sh
# Investigates device registration non-conformities between ThingsBoard and GCDR.
#
# Strategy: bulk-fetch all GCDR devices per customer first, then compare
# in memory — reduces N API calls to a handful of paginated requests.
#
# Input file (pipe-delimited):
#   tbId|deviceName|label|identifier|deviceType|deviceProfile|slaveId|
#   centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt
#
# Auth modes:
#   --auth apikey   → X-API-Key header (default)
#   --auth jwt      → POST /auth/login with email + password
#
# Usage:
#   ./check-inconformidades.sh --file device-map-energy-2026-03-10-energy-entry.txt
#   ./check-inconformidades.sh --file target.txt --auth jwt
#   GCDR_API_URL=http://localhost:3015 ./check-inconformidades.sh --file device-map-water-2026-03-10-water-stores.txt
#
# Output:
#   - Colored summary to stdout
#   - inconformidades-report-<input-basename>-<timestamp>.json in the same directory
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_FILE=""

# Load local config (overrides defaults; env vars still take precedence)
[[ -f "$SCRIPT_DIR/config.env" ]] && source "$SCRIPT_DIR/config.env"

# ---------------------------------------------------------------------------
# Configuration (override via env vars)
# ---------------------------------------------------------------------------
API_URL="${GCDR_API_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_myio_tenant_bundle_key_2026}"
ADMIN_EMAIL="${GCDR_EMAIL:-admin@gcdr.io}"
ADMIN_PASSWORD="${GCDR_PASSWORD:-Test123!}"
AUTH_MODE="${GCDR_AUTH_MODE:-apikey}"
PAGE_SIZE=500

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --auth) AUTH_MODE="$2"; shift 2 ;;
    --url)  API_URL="$2";   shift 2 ;;
    --file) TARGET_FILE="$SCRIPT_DIR/$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Default to target.txt for backwards compatibility
[[ -z "$TARGET_FILE" ]] && TARGET_FILE="$SCRIPT_DIR/target.txt"

INPUT_BASENAME="$(basename "$TARGET_FILE" .txt)"
REPORT_FILE="$SCRIPT_DIR/inconformidades-report-${INPUT_BASENAME}-$(date +%Y%m%d-%H%M%S).json"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
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
section() { echo -e "\n${BOLD}$*${NC}"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required: '$1' not found."; exit 1; }
}
require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Validate input file
# ---------------------------------------------------------------------------
[[ ! -f "$TARGET_FILE" ]] && { fail "Input file not found: $TARGET_FILE"; exit 1; }

TOTAL_DEVICES=$(awk -F'|' 'NF==12 && $1!="tbId" && $1!~/^\[/' "$TARGET_FILE" | wc -l | tr -d ' ')
if [[ "$TOTAL_DEVICES" -eq 0 ]]; then
  warn "$(basename "$TARGET_FILE") has no device rows — nothing to check."
  exit 0
fi

# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
AUTH_HEADER=""

if [[ "$AUTH_MODE" == "jwt" ]]; then
  section "Authenticating via JWT..."
  LOGIN=$(curl -s -X POST "$API_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
  JWT_TOKEN=$(echo "$LOGIN" | jq -r '.data.accessToken // .accessToken // empty')
  [[ -z "$JWT_TOKEN" ]] && { fail "Login failed:"; echo "$LOGIN" | jq .; exit 1; }
  AUTH_HEADER="Authorization: Bearer $JWT_TOKEN"
  ok "JWT obtained."
else
  AUTH_HEADER="X-API-Key: $API_KEY"
  ok "API Key: ${API_KEY:0:24}..."
fi

gcdr_get() {
  curl -s "$API_URL/api/v1$1" -H "$AUTH_HEADER" -H "Accept: application/json"
}

# ---------------------------------------------------------------------------
# Step 1 — Extract unique customer IDs from target.txt
# ---------------------------------------------------------------------------
section "Step 1 — Collecting customer IDs from target.txt..."

CUSTOMER_IDS=$(awk -F'|' 'NF==12 && $1!="tbId" && $1!~/^\[/ && $9!="" {print $9}' "$TARGET_FILE" | sort -u)
CUSTOMER_COUNT=$(echo "$CUSTOMER_IDS" | grep -c . || true)

if [[ "$CUSTOMER_COUNT" -eq 0 ]]; then
  if [[ -n "${GCDR_CUSTOMER_ID:-}" ]]; then
    info "Using GCDR_CUSTOMER_ID from config.env: $GCDR_CUSTOMER_ID"
    CUSTOMER_IDS="$GCDR_CUSTOMER_ID"
    CUSTOMER_COUNT=1
  else
    warn "No gcdrCustomerId found in $(basename "$TARGET_FILE") — will search the full tenant."
    CUSTOMER_IDS=""
  fi
fi

info "Customers to fetch: $CUSTOMER_COUNT"
echo "$CUSTOMER_IDS" | while read -r cid; do [[ -n "$cid" ]] && echo "  · $cid"; done

# ---------------------------------------------------------------------------
# Step 2 — Bulk fetch all GCDR devices per customer
# ---------------------------------------------------------------------------
section "Step 2 — Fetching all GCDR devices (bulk)..."

GCDR_DEVICES_FILE=$(mktemp /tmp/gcdr_devices_XXXXXX.json)
echo "[]" > "$GCDR_DEVICES_FILE"
trap 'rm -f "$GCDR_DEVICES_FILE"' EXIT

fetch_customer_devices() {
  local customer_id="$1"
  local page=1

  while true; do
    local offset=$(( (page - 1) * PAGE_SIZE ))
    local resp
    if [[ -n "$customer_id" ]]; then
      resp=$(gcdr_get "/customers/$customer_id/devices?pageSize=$PAGE_SIZE&cursor=$offset")
    else
      resp=$(gcdr_get "/devices?pageSize=$PAGE_SIZE&cursor=$offset")
    fi

    local success items_count total
    success=$(echo "$resp" | jq -r '.success // false')
    if [[ "$success" != "true" ]]; then
      warn "  Failed (customer=$customer_id page=$page): $(echo "$resp" | jq -r '.message // "unknown"')"
      break
    fi

    items_count=$(echo "$resp" | jq '.data.items | length')
    total=$(echo "$resp" | jq -r '.data.pagination.total // 0')

    # Append new items to the temp file (no process substitution — Windows compat)
    echo "$resp" | jq '.data.items' > "${GCDR_DEVICES_FILE}.batch"
    jq -s '.[0] + .[1]' "$GCDR_DEVICES_FILE" "${GCDR_DEVICES_FILE}.batch" > "${GCDR_DEVICES_FILE}.tmp" \
      && mv "${GCDR_DEVICES_FILE}.tmp" "$GCDR_DEVICES_FILE"

    local fetched
    fetched=$(jq 'length' "$GCDR_DEVICES_FILE")
    info "  customer=$customer_id  fetched=$fetched / total=$total"

    local has_more
    has_more=$(echo "$resp" | jq -r '.data.pagination.hasMore // false')
    [[ "$has_more" != "true" || "$items_count" -eq 0 ]] && break
    page=$((page + 1))
  done
}

if [[ -n "$CUSTOMER_IDS" ]]; then
  while IFS= read -r cid; do
    [[ -z "$cid" ]] && continue
    fetch_customer_devices "$cid"
  done <<< "$CUSTOMER_IDS"
else
  fetch_customer_devices ""
fi

GCDR_TOTAL=$(jq 'length' "$GCDR_DEVICES_FILE")
ok "Total GCDR devices loaded: $GCDR_TOTAL"

# ---------------------------------------------------------------------------
# Step 3 — Compare target.txt against in-memory GCDR dataset
# ---------------------------------------------------------------------------
section "Step 3 — Comparing $TOTAL_DEVICES TB device(s) against GCDR..."
echo ""

# RESULTS_FILE: one JSON object per line (NDJSON) — merged into array at the end
RESULTS_FILE=$(mktemp /tmp/gcdr_results_XXXXXX.ndjson)
: > "$RESULTS_FILE"
trap 'rm -f "$GCDR_DEVICES_FILE" "$RESULTS_FILE" "${GCDR_DEVICES_FILE}.batch" "${GCDR_DEVICES_FILE}.tmp" /tmp/gcdr_entry_data.json /tmp/gcdr_entry_divs.json' EXIT
COUNT_OK=0
COUNT_MISSING=0
COUNT_DIVERGENT=0

lookup_gcdr_device() {
  local gcdr_device_id="$1"
  local tb_id="$2"
  local identifier="$3"
  local result=""

  # Priority 1: by gcdrDeviceId
  if [[ -n "$gcdr_device_id" ]]; then
    result=$(jq -r --arg id "$gcdr_device_id" '.[] | select(.id == $id)' "$GCDR_DEVICES_FILE")
  fi

  # Priority 2: by externalId = tbId
  if [[ -z "$result" && -n "$tb_id" ]]; then
    result=$(jq -r --arg eid "$tb_id" '.[] | select(.externalId == $eid)' "$GCDR_DEVICES_FILE")
  fi

  # Priority 3: by identifier (exact)
  if [[ -z "$result" && -n "$identifier" ]]; then
    result=$(jq -r --arg idf "$identifier" '.[] | select(.identifier == $idf)' "$GCDR_DEVICES_FILE" | head -c 4096)
  fi

  echo "$result"
}

while IFS='|' read -r tbId deviceName label identifier deviceType deviceProfile slaveId centralId gcdrCustomerId gcdrAssetId gcdrDeviceId gcdrSyncAt; do
  # Skip header, comments, blank lines
  [[ "$tbId" == "tbId" || -z "$tbId" || "$tbId" == \[* ]] && continue

  tbId="${tbId// /}"
  gcdrDeviceId="${gcdrDeviceId// /}"

  echo -e "  ${BOLD}$deviceName${NC} (TB: ${tbId:0:8}…)"

  STATUS="UNKNOWN"
  DIVERGENCES=()
  GCDR_DATA="{}"

  # Lookup in memory
  GCDR_DATA=$(lookup_gcdr_device "$gcdrDeviceId" "$tbId" "$identifier")

  if [[ -z "$GCDR_DATA" ]]; then
    warn "  → NOT FOUND in GCDR"
    STATUS="NOT_LINKED"
    COUNT_MISSING=$((COUNT_MISSING + 1))
  else
    # Field comparison
    gcdr_label=$(echo "$GCDR_DATA"     | jq -r '.label // ""')
    gcdr_profile=$(echo "$GCDR_DATA"   | jq -r '.deviceProfile // ""')
    gcdr_slaveId=$(echo "$GCDR_DATA"   | jq -r '.slaveId // ""')
    gcdr_centralId=$(echo "$GCDR_DATA" | jq -r '.centralId // ""')
    gcdr_customerId=$(echo "$GCDR_DATA"| jq -r '.customerId // ""')
    gcdr_assetId=$(echo "$GCDR_DATA"   | jq -r '.assetId // ""')
    gcdr_externalId=$(echo "$GCDR_DATA"| jq -r '.externalId // ""')
    gcdr_identifier=$(echo "$GCDR_DATA"| jq -r '.identifier // ""')

    [[ -n "$label"          && "$gcdr_label"      != "$label"          ]] && DIVERGENCES+=("label: TB='$label' GCDR='$gcdr_label'")
    [[ -n "$deviceProfile"  && "$gcdr_profile"    != "$deviceProfile"  ]] && DIVERGENCES+=("deviceProfile: TB='$deviceProfile' GCDR='$gcdr_profile'")
    if [[ -n "$slaveId" ]] && echo "$slaveId" | grep -qE '^[0-9]+$'; then
      [[ "$gcdr_slaveId" != "$slaveId" ]] && DIVERGENCES+=("slaveId: TB='$slaveId' GCDR='$gcdr_slaveId'")
    fi
    [[ -n "$centralId"      && "$gcdr_centralId"  != "$centralId"      ]] && DIVERGENCES+=("centralId: TB='$centralId' GCDR='$gcdr_centralId'")
    [[ -n "$gcdrCustomerId" && "$gcdr_customerId" != "$gcdrCustomerId"  ]] && DIVERGENCES+=("customerId: TB_attr='$gcdrCustomerId' GCDR='$gcdr_customerId'")
    [[ -n "$gcdrAssetId"    && "$gcdr_assetId"    != "$gcdrAssetId"     ]] && DIVERGENCES+=("assetId: TB_attr='$gcdrAssetId' GCDR='$gcdr_assetId'")
    [[ -n "$tbId"           && "$gcdr_externalId" != "$tbId"            ]] && DIVERGENCES+=("externalId: TB_id='$tbId' GCDR='$gcdr_externalId'")
    # identifier: only flag if GCDR has one and it differs (case-insensitive mismatch is OK by design)
    [[ -n "$identifier" && -n "$gcdr_identifier" && "${gcdr_identifier,,}" != "${identifier,,}" ]] && \
      DIVERGENCES+=("identifier: TB='$identifier' GCDR='$gcdr_identifier'")

    if [[ ${#DIVERGENCES[@]} -eq 0 ]]; then
      ok "  → CONFORMANT"
      STATUS="CONFORMANT"
      COUNT_OK=$((COUNT_OK + 1))
    else
      fail "  → DIVERGENT (${#DIVERGENCES[@]} field(s)):"
      for d in "${DIVERGENCES[@]}"; do
        echo -e "       ${RED}✗${NC} $d"
      done
      STATUS="DIVERGENT"
      COUNT_DIVERGENT=$((COUNT_DIVERGENT + 1))
    fi
  fi

  # Build result entry — write GCDR_DATA to temp file to avoid arg-length limits
  DIV_JSON=$(printf '%s\n' "${DIVERGENCES[@]:-}" | grep . | jq -R . | jq -s . 2>/dev/null || echo "[]")
  echo "${GCDR_DATA:-{\}}" > /tmp/gcdr_entry_data.json
  echo "$DIV_JSON"         > /tmp/gcdr_entry_divs.json
  ENTRY=$(jq -n \
    --arg tbId "$tbId" \
    --arg deviceName "$deviceName" \
    --arg status "$STATUS" \
    --slurpfile divergences /tmp/gcdr_entry_divs.json \
    --slurpfile gcdrData    /tmp/gcdr_entry_data.json \
    --arg tb_label "$label" \
    --arg tb_identifier "$identifier" \
    --arg tb_deviceType "$deviceType" \
    --arg tb_deviceProfile "$deviceProfile" \
    --arg tb_slaveId "$slaveId" \
    --arg tb_centralId "$centralId" \
    --arg tb_gcdrCustomerId "$gcdrCustomerId" \
    --arg tb_gcdrAssetId "$gcdrAssetId" \
    --arg tb_gcdrDeviceId "$gcdrDeviceId" \
    --arg tb_gcdrSyncAt "$gcdrSyncAt" \
    '{
      tbId: $tbId, deviceName: $deviceName, status: $status,
      tb: {
        label: $tb_label, identifier: $tb_identifier,
        deviceType: $tb_deviceType, deviceProfile: $tb_deviceProfile,
        slaveId: $tb_slaveId, centralId: $tb_centralId,
        gcdrCustomerId: $tb_gcdrCustomerId, gcdrAssetId: $tb_gcdrAssetId,
        gcdrDeviceId: $tb_gcdrDeviceId, gcdrSyncAt: $tb_gcdrSyncAt
      },
      gcdr: $gcdrData[0],
      divergences: $divergences[0]
    }')

  # Append entry as NDJSON (one JSON object per line — O(1) write, no rewrite)
  echo "$ENTRY" >> "$RESULTS_FILE"
  echo ""

done < "$TARGET_FILE"

# ---------------------------------------------------------------------------
# Write JSON report — convert NDJSON → JSON array, then build report
# ---------------------------------------------------------------------------
RESULTS_ARRAY_FILE="${RESULTS_FILE}.array"
jq -s '.' "$RESULTS_FILE" > "$RESULTS_ARRAY_FILE"
trap 'rm -f "$GCDR_DEVICES_FILE" "$RESULTS_FILE" "$RESULTS_ARRAY_FILE" "${GCDR_DEVICES_FILE}.batch" "${GCDR_DEVICES_FILE}.tmp" /tmp/gcdr_entry_data.json /tmp/gcdr_entry_divs.json' EXIT

jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg apiUrl "$API_URL" \
  --arg authMode "$AUTH_MODE" \
  --argjson totalTb "$TOTAL_DEVICES" \
  --argjson totalGcdr "$GCDR_TOTAL" \
  --argjson conformant "$COUNT_OK" \
  --argjson divergent "$COUNT_DIVERGENT" \
  --argjson missing "$COUNT_MISSING" \
  --slurpfile results "$RESULTS_ARRAY_FILE" \
  '{
    meta: {
      generatedAt: $generatedAt, apiUrl: $apiUrl, authMode: $authMode,
      totals: {
        tbDevices: $totalTb, gcdrDevicesLoaded: $totalGcdr,
        conformant: $conformant, divergent: $divergent, missing: $missing
      }
    },
    results: $results[0]
  }' > "$REPORT_FILE"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "======================================="
section "  REPORT SUMMARY"
section "======================================="
echo -e "  TB devices        : ${BOLD}$TOTAL_DEVICES${NC}"
echo -e "  GCDR devices loaded: ${BOLD}$GCDR_TOTAL${NC}"
echo -e "  ${GREEN}Conformant${NC}         : $COUNT_OK"
echo -e "  ${RED}Divergent${NC}          : $COUNT_DIVERGENT"
echo -e "  ${YELLOW}Not found / unlinked${NC}: $COUNT_MISSING"
echo ""
echo -e "  Report: ${CYAN}$REPORT_FILE${NC}"
section "======================================="

[[ $((COUNT_DIVERGENT + COUNT_MISSING)) -gt 0 ]] && exit 2
exit 0
