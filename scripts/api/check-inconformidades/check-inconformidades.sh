#!/bin/bash
# =============================================================================
# check-inconformidades.sh
# Investigates device registration non-conformities between ThingsBoard and GCDR.
#
# Reads target.txt (pipe-delimited) from the same directory:
#   tbId|deviceName|label|deviceType|deviceProfile|slaveId|centralId|
#   gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt
#
# Auth modes (set via env or flags):
#   --auth apikey   → X-API-Key header (default)
#   --auth jwt      → POST /auth/login with email + password
#
# Usage:
#   ./check-inconformidades.sh
#   ./check-inconformidades.sh --auth jwt
#   GCDR_API_URL=http://localhost:3015 ./check-inconformidades.sh
#
# Output:
#   - Colored summary to stdout
#   - inconformidades-report-<timestamp>.json in the same directory
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_FILE="$SCRIPT_DIR/target.txt"

# ---------------------------------------------------------------------------
# Configuration (override via env vars)
# ---------------------------------------------------------------------------
API_URL="${GCDR_API_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_myio_tenant_bundle_key_2026}"
ADMIN_EMAIL="${GCDR_EMAIL:-admin@gcdr.io}"
ADMIN_PASSWORD="${GCDR_PASSWORD:-Test123!}"
AUTH_MODE="${GCDR_AUTH_MODE:-apikey}"   # apikey | jwt

# Parse --auth flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --auth) AUTH_MODE="$2"; shift 2 ;;
    --url)  API_URL="$2";   shift 2 ;;
    *) shift ;;
  esac
done

REPORT_FILE="$SCRIPT_DIR/inconformidades-report-$(date +%Y%m%d-%H%M%S).json"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()    { echo -e "${RED}[FAIL]${NC} $*"; }
section() { echo -e "\n${BOLD}$*${NC}"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command '$1' not found. Install it and retry."; exit 1; }
}

require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Validate target.txt
# ---------------------------------------------------------------------------
if [[ ! -f "$TARGET_FILE" ]]; then
  fail "target.txt not found at: $TARGET_FILE"
  exit 1
fi

TOTAL_LINES=$(tail -n +2 "$TARGET_FILE" | grep -v '^\s*$' | wc -l | tr -d ' ')
if [[ "$TOTAL_LINES" -eq 0 ]]; then
  fail "target.txt has no device rows (only header or empty)."
  exit 1
fi

# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
AUTH_HEADER=""

if [[ "$AUTH_MODE" == "jwt" ]]; then
  section "Authenticating via JWT (email/password)..."
  LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

  JWT_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.accessToken // .accessToken // empty')

  if [[ -z "$JWT_TOKEN" ]]; then
    fail "Login failed. Response:"
    echo "$LOGIN_RESPONSE" | jq . 2>/dev/null || echo "$LOGIN_RESPONSE"
    exit 1
  fi

  AUTH_HEADER="Authorization: Bearer $JWT_TOKEN"
  ok "JWT obtained."

else
  section "Using API Key auth..."
  AUTH_HEADER="X-API-Key: $API_KEY"
  ok "API Key: ${API_KEY:0:20}..."
fi

# ---------------------------------------------------------------------------
# Helper: call GCDR
# ---------------------------------------------------------------------------
gcdr_get() {
  local path="$1"
  curl -s "$API_URL/api/v1$path" \
    -H "$AUTH_HEADER" \
    -H "Accept: application/json"
}

# ---------------------------------------------------------------------------
# Process devices
# ---------------------------------------------------------------------------
section "Processing $TOTAL_LINES device(s) from target.txt..."
echo ""

RESULTS=()
COUNT_OK=0
COUNT_MISSING=0
COUNT_DIVERGENT=0
COUNT_ERROR=0

while IFS='|' read -r tbId deviceName label deviceType deviceProfile slaveId centralId gcdrCustomerId gcdrAssetId gcdrDeviceId gcdrSyncAt; do
  # Skip header and blank lines
  [[ "$tbId" == "tbId" || -z "$tbId" ]] && continue

  # Trim whitespace
  tbId="${tbId// /}"
  gcdrDeviceId="${gcdrDeviceId// /}"
  gcdrCustomerId="${gcdrCustomerId// /}"

  echo -e "  ${BOLD}Device:${NC} $deviceName (TB: $tbId)"

  STATUS="UNKNOWN"
  DIVERGENCES=()
  GCDR_DATA="{}"

  # --- Resolve GCDR device ---
  if [[ -n "$gcdrDeviceId" ]]; then
    # Known gcdrDeviceId → fetch directly
    RESPONSE=$(gcdr_get "/devices/$gcdrDeviceId")
    SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')

    if [[ "$SUCCESS" != "true" ]]; then
      warn "  → gcdrDeviceId $gcdrDeviceId not found in GCDR."
      STATUS="MISSING_IN_GCDR"
      COUNT_MISSING=$((COUNT_MISSING + 1))
    else
      GCDR_DATA=$(echo "$RESPONSE" | jq '.data')
      STATUS="FOUND"
    fi
  else
    # No gcdrDeviceId → try to find by externalId (tbId)
    SEARCH=$(gcdr_get "/devices?externalId=$tbId")
    FOUND_COUNT=$(echo "$SEARCH" | jq -r '.data.pagination.total // 0')

    if [[ "$FOUND_COUNT" == "0" || "$FOUND_COUNT" == "null" ]]; then
      # Try by identifier
      SEARCH=$(gcdr_get "/devices?identifier=$tbId")
      FOUND_COUNT=$(echo "$SEARCH" | jq -r '.data.pagination.total // 0')
    fi

    if [[ "$FOUND_COUNT" == "0" || "$FOUND_COUNT" == "null" ]]; then
      warn "  → Not found in GCDR (no gcdrDeviceId, externalId=$tbId returned 0 results)."
      STATUS="NOT_LINKED"
      COUNT_MISSING=$((COUNT_MISSING + 1))
    else
      GCDR_DATA=$(echo "$SEARCH" | jq '.data.items[0]')
      STATUS="FOUND"
      info "  → Found via search (externalId/identifier match)."
    fi
  fi

  # --- Field comparison ---
  if [[ "$STATUS" == "FOUND" ]]; then
    gcdr_label=$(echo "$GCDR_DATA" | jq -r '.label // ""')
    gcdr_profile=$(echo "$GCDR_DATA" | jq -r '.deviceProfile // ""')
    gcdr_slaveId=$(echo "$GCDR_DATA" | jq -r '.slaveId // ""')
    gcdr_centralId=$(echo "$GCDR_DATA" | jq -r '.centralId // ""')
    gcdr_customerId=$(echo "$GCDR_DATA" | jq -r '.customerId // ""')
    gcdr_assetId=$(echo "$GCDR_DATA" | jq -r '.assetId // ""')
    gcdr_externalId=$(echo "$GCDR_DATA" | jq -r '.externalId // ""')

    [[ -n "$label"         && "$gcdr_label"      != "$label"         ]] && DIVERGENCES+=("label: TB='$label' GCDR='$gcdr_label'")
    [[ -n "$deviceProfile" && "$gcdr_profile"    != "$deviceProfile" ]] && DIVERGENCES+=("deviceProfile: TB='$deviceProfile' GCDR='$gcdr_profile'")
    [[ -n "$slaveId"       && "$gcdr_slaveId"    != "$slaveId"       ]] && DIVERGENCES+=("slaveId: TB='$slaveId' GCDR='$gcdr_slaveId'")
    [[ -n "$centralId"     && "$gcdr_centralId"  != "$centralId"     ]] && DIVERGENCES+=("centralId: TB='$centralId' GCDR='$gcdr_centralId'")
    [[ -n "$gcdrCustomerId" && "$gcdr_customerId" != "$gcdrCustomerId" ]] && DIVERGENCES+=("customerId: TB_attr='$gcdrCustomerId' GCDR='$gcdr_customerId'")
    [[ -n "$gcdrAssetId"   && "$gcdr_assetId"    != "$gcdrAssetId"   ]] && DIVERGENCES+=("assetId: TB_attr='$gcdrAssetId' GCDR='$gcdr_assetId'")
    [[ -n "$tbId"          && "$gcdr_externalId" != "$tbId"          ]] && DIVERGENCES+=("externalId: TB_id='$tbId' GCDR='$gcdr_externalId'")

    if [[ ${#DIVERGENCES[@]} -eq 0 ]]; then
      ok "  → CONFORMANT — all fields match."
      STATUS="CONFORMANT"
      COUNT_OK=$((COUNT_OK + 1))
    else
      fail "  → DIVERGENT:"
      for d in "${DIVERGENCES[@]}"; do
        echo -e "       ${RED}✗${NC} $d"
      done
      STATUS="DIVERGENT"
      COUNT_DIVERGENT=$((COUNT_DIVERGENT + 1))
    fi
  fi

  # --- Build result entry ---
  DIVERGENCES_JSON=$(printf '%s\n' "${DIVERGENCES[@]}" | jq -R . | jq -s .)
  RESULT_ENTRY=$(jq -n \
    --arg tbId "$tbId" \
    --arg deviceName "$deviceName" \
    --arg label "$label" \
    --arg deviceType "$deviceType" \
    --arg deviceProfile "$deviceProfile" \
    --arg slaveId "$slaveId" \
    --arg centralId "$centralId" \
    --arg gcdrCustomerId "$gcdrCustomerId" \
    --arg gcdrAssetId "$gcdrAssetId" \
    --arg gcdrDeviceId "$gcdrDeviceId" \
    --arg gcdrSyncAt "$gcdrSyncAt" \
    --arg status "$STATUS" \
    --argjson divergences "$DIVERGENCES_JSON" \
    --argjson gcdrData "$GCDR_DATA" \
    '{
      tbId: $tbId,
      deviceName: $deviceName,
      tb: {
        label: $label,
        deviceType: $deviceType,
        deviceProfile: $deviceProfile,
        slaveId: $slaveId,
        centralId: $centralId,
        gcdrCustomerId: $gcdrCustomerId,
        gcdrAssetId: $gcdrAssetId,
        gcdrDeviceId: $gcdrDeviceId,
        gcdrSyncAt: $gcdrSyncAt
      },
      gcdr: $gcdrData,
      status: $status,
      divergences: $divergences
    }')

  RESULTS+=("$RESULT_ENTRY")
  echo ""

done < "$TARGET_FILE"

# ---------------------------------------------------------------------------
# Write JSON report
# ---------------------------------------------------------------------------
RESULTS_JSON=$(printf '%s\n' "${RESULTS[@]}" | jq -s .)

jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg apiUrl "$API_URL" \
  --arg authMode "$AUTH_MODE" \
  --argjson totalDevices "$TOTAL_LINES" \
  --argjson conformant "$COUNT_OK" \
  --argjson divergent "$COUNT_DIVERGENT" \
  --argjson missing "$COUNT_MISSING" \
  --argjson errors "$COUNT_ERROR" \
  --argjson results "$RESULTS_JSON" \
  '{
    meta: {
      generatedAt: $generatedAt,
      apiUrl: $apiUrl,
      authMode: $authMode,
      totals: {
        devices: $totalDevices,
        conformant: $conformant,
        divergent: $divergent,
        missing: $missing,
        errors: $errors
      }
    },
    results: $results
  }' > "$REPORT_FILE"

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
section "======================================="
section "  REPORT SUMMARY"
section "======================================="
echo -e "  Total devices    : ${BOLD}$TOTAL_LINES${NC}"
echo -e "  ${GREEN}Conformant${NC}        : $COUNT_OK"
echo -e "  ${RED}Divergent${NC}         : $COUNT_DIVERGENT"
echo -e "  ${YELLOW}Missing / unlinked${NC}: $COUNT_MISSING"
echo ""
echo -e "  Report saved to:"
echo -e "  ${CYAN}$REPORT_FILE${NC}"
section "======================================="

# Exit with error code if any non-conformities found
if [[ $((COUNT_DIVERGENT + COUNT_MISSING)) -gt 0 ]]; then
  exit 2
fi
exit 0
