#!/bin/bash
# =============================================================================
# audit-jobs.sh — Auditoria de Device Sync Jobs via API GCDR
#
# Modos de uso:
#   ./audit-jobs.sh --customer metropole-ananindeua
#   ./audit-jobs.sh --customer metropole-ananindeua --status PARTIAL
#   ./audit-jobs.sh --customer metropole-ananindeua --status FAILED --page 2
#   ./audit-jobs.sh --job d3b8a1f0-9c2e-4a11-b3c7-000000000099
#   ./audit-jobs.sh --job d3b8a1f0-9c2e-4a11-b3c7-000000000099 --log
#   ./audit-jobs.sh --job d3b8a1f0-9c2e-4a11-b3c7-000000000099 --log --fails-only
#
# Auth modes:
#   --auth apikey   → X-API-Key header (default)
#   --auth jwt      → POST /auth/login com email + password
#
# Variáveis de ambiente:
#   GCDR_API_URL    — default: https://gcdr-api.a.myio-bas.com
#   GCDR_API_KEY    — default: gcdr_myio_tenant_bundle_key_2026
#   GCDR_EMAIL      — usado com --auth jwt
#   GCDR_PASSWORD   — usado com --auth jwt
#   GCDR_CUSTOMER_ID — customer ID (lido do config.env do customer)
#
# Output:
#   - Resumo colorido no stdout
#   - audit-jobs-report-<timestamp>.json em customers/<name>/ (modo --customer)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
API_URL="${GCDR_API_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_myio_tenant_bundle_key_2026}"
ADMIN_EMAIL="${GCDR_EMAIL:-admin@gcdr.io}"
ADMIN_PASSWORD="${GCDR_PASSWORD:-Test123!}"
AUTH_MODE="${GCDR_AUTH_MODE:-apikey}"

CUSTOMER_NAME=""
CUSTOMER_ID=""
STATUS_FILTER=""
JOB_ID=""
SHOW_LOG=false
FAILS_ONLY=false
PAGE=1
PAGE_SIZE=20

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --customer)   CUSTOMER_NAME="$2"; shift 2 ;;
    --status)     STATUS_FILTER="$2"; shift 2 ;;
    --job)        JOB_ID="$2"; shift 2 ;;
    --log)        SHOW_LOG=true; shift ;;
    --fails-only) FAILS_ONLY=true; shift ;;
    --auth)       AUTH_MODE="$2"; shift 2 ;;
    --url)        API_URL="$2"; shift 2 ;;
    --page)       PAGE="$2"; shift 2 ;;
    --size)       PAGE_SIZE="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "[FAIL] Opção desconhecida: $1"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Load customer config.env (if --customer provided)
# ---------------------------------------------------------------------------
if [[ -n "$CUSTOMER_NAME" ]]; then
  CUSTOMER_DIR="$SCRIPT_DIR/customers/$CUSTOMER_NAME"
  [[ ! -d "$CUSTOMER_DIR" ]] && { echo "[FAIL] Customer directory not found: $CUSTOMER_DIR"; exit 1; }
  [[ -f "$CUSTOMER_DIR/config.env" ]] && source "$CUSTOMER_DIR/config.env"

  # Env vars still take precedence after sourcing
  API_URL="${GCDR_API_URL:-$API_URL}"
  API_KEY="${GCDR_API_KEY:-$API_KEY}"
  AUTH_MODE="${GCDR_AUTH_MODE:-$AUTH_MODE}"
  CUSTOMER_ID="${GCDR_CUSTOMER_ID:-}"

  [[ -z "$CUSTOMER_ID" ]] && { echo "[FAIL] GCDR_CUSTOMER_ID not set in $CUSTOMER_DIR/config.env"; exit 1; }
fi

[[ -z "$CUSTOMER_ID" && -z "$JOB_ID" ]] && {
  echo "[FAIL] Forneça --customer <name> ou --job <uuid>"
  exit 1
}

# ---------------------------------------------------------------------------
# Colors + helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
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
# Header
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}  GCDR Audit Jobs — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "  URL: ${CYAN}$API_URL${NC}"

# =============================================================================
# Modo A: --job <uuid>  →  status detalhado + log opcional
# =============================================================================
if [[ -n "$JOB_ID" ]]; then

  section "=== JOB: $JOB_ID ==="

  JOB=$(gcdr_get "/device-sync/jobs/$JOB_ID")

  if echo "$JOB" | jq -e '.success == false' > /dev/null 2>&1; then
    fail "$(echo "$JOB" | jq -r '.error.message')"
    exit 1
  fi

  STATUS=$(echo "$JOB"    | jq -r '.data.status')
  PHASE=$(echo "$JOB"     | jq -r '.data.currentPhase')
  DRY=$(echo "$JOB"       | jq -r '.data.dryRun')
  CID=$(echo "$JOB"       | jq -r '.data.customerId')
  DURATION=$(echo "$JOB"  | jq -r 'if .data.durationMs then "\(.data.durationMs)ms" else "em andamento" end')
  CREATED=$(echo "$JOB"   | jq -r '.data.createdAt')
  COMPLETED=$(echo "$JOB" | jq -r '.data.completedAt // "-"')

  echo ""
  case "$STATUS" in
    DONE)    echo -e "  Status      : ${GREEN}${BOLD}$STATUS${NC}" ;;
    PARTIAL) echo -e "  Status      : ${YELLOW}${BOLD}$STATUS${NC}" ;;
    FAILED)  echo -e "  Status      : ${RED}${BOLD}$STATUS${NC}" ;;
    RUNNING) echo -e "  Status      : ${CYAN}${BOLD}$STATUS${NC}" ;;
    *)       echo -e "  Status      : $STATUS" ;;
  esac
  echo -e "  Fase atual  : $PHASE"
  echo -e "  Customer    : $CID"
  echo -e "  Dry run     : $DRY"
  echo -e "  Criado em   : $CREATED"
  echo -e "  Concluído   : $COMPLETED"
  echo -e "  Duração     : $DURATION"

  echo ""
  echo -e "${BOLD}  Resumo por fase:${NC}"
  echo "$JOB" | jq -r '
    .data.summary // {} | to_entries[] |
    "  \(.key): \(.value | to_entries | map("\(.key)=\(.value)") | join("  "))"
  '

  if [[ "$SHOW_LOG" == true ]]; then
    section "=== LOG: $JOB_ID ==="
    LOG=$(gcdr_get "/device-sync/jobs/$JOB_ID/log")

    if echo "$LOG" | jq -e '.success == false' > /dev/null 2>&1; then
      fail "Erro ao buscar log: $(echo "$LOG" | jq -r '.error.message')"
      exit 1
    fi

    TOTAL_ENTRIES=$(echo "$LOG" | jq '.data.entries | length')
    FAIL_COUNT=$(echo "$LOG" | jq '[.data.entries[] | select(.level == "FAIL" or .level == "ERROR")] | length')

    echo ""
    info "Entradas: $TOTAL_ENTRIES   Falhas: $FAIL_COUNT"
    echo ""

    # Filter se --fails-only
    JQ_FILTER='.data.entries[]'
    [[ "$FAILS_ONLY" == true ]] && JQ_FILTER='.data.entries[] | select(.level == "FAIL" or .level == "ERROR")'

    echo "$LOG" | jq -r "
      $JQ_FILTER |
      [ (.ts | split(\"T\")[1] | split(\".\")[0]), .phase, .level, .message ] | @tsv
    " | while IFS=$'\t' read -r ts phase level message; do
      LINE="  $ts  $(printf '%-25s' "$phase")  $(printf '%-5s' "$level")  $message"
      case "$level" in
        OK)         echo -e "${GREEN}$LINE${NC}" ;;
        FAIL|ERROR) echo -e "${RED}$LINE${NC}" ;;
        WARN)       echo -e "${YELLOW}$LINE${NC}" ;;
        *)          echo -e "${DIM}$LINE${NC}" ;;
      esac
    done
  fi

  echo ""
  exit 0
fi

# =============================================================================
# Modo B: --customer <name>  →  lista jobs + grava report JSON
# =============================================================================
QUERY="page=${PAGE}&pageSize=${PAGE_SIZE}&customerId=${CUSTOMER_ID}"
[[ -n "$STATUS_FILTER" ]] && QUERY="${QUERY}&status=${STATUS_FILTER}"

section "=== JOBS — customer: $CUSTOMER_NAME ($CUSTOMER_ID) ==="
[[ -n "$STATUS_FILTER" ]] && info "Filtro de status: $STATUS_FILTER"

RESP=$(gcdr_get "/device-sync/jobs?${QUERY}")

if echo "$RESP" | jq -e '.success == false' > /dev/null 2>&1; then
  fail "$(echo "$RESP" | jq -r '.error.message')"
  exit 1
fi

TOTAL=$(echo "$RESP" | jq -r '.pagination.total')
PAGES=$(echo "$RESP" | jq -r '.pagination.totalPages')
COUNT=$(echo "$RESP" | jq -r '.data | length')

echo ""
info "Total: $TOTAL job(s)   Páginas: $PAGES   Exibindo: $COUNT"
echo ""

COUNT_DONE=0
COUNT_PARTIAL=0
COUNT_FAILED=0
COUNT_RUNNING=0
COUNT_QUEUED=0

echo "$RESP" | jq -r '
  .data[] |
  [ .jobId, .status, (.dryRun | tostring),
    (if .durationMs then "\(.durationMs)ms" else "-" end),
    (.createdAt | split("T") | .[0] + " " + (.[1] | split(".")[0])),
    .customerId
  ] | @tsv
' | while IFS=$'\t' read -r jobId status dryRun duration createdAt customerId; do
  case "$status" in
    DONE)    echo -e "  ${GREEN}${BOLD}DONE   ${NC}  $jobId  dry=$dryRun  $duration  $createdAt" ;;
    PARTIAL) echo -e "  ${YELLOW}${BOLD}PARTIAL${NC}  $jobId  dry=$dryRun  $duration  $createdAt" ;;
    FAILED)  echo -e "  ${RED}${BOLD}FAILED ${NC}  $jobId  dry=$dryRun  $duration  $createdAt" ;;
    RUNNING) echo -e "  ${CYAN}${BOLD}RUNNING${NC}  $jobId  dry=$dryRun  $duration  $createdAt" ;;
    *)       echo -e "  $status  $jobId  dry=$dryRun  $duration  $createdAt" ;;
  esac
done

# Contagens por status
COUNT_DONE=$(echo "$RESP"    | jq '[.data[] | select(.status == "DONE")]    | length')
COUNT_PARTIAL=$(echo "$RESP" | jq '[.data[] | select(.status == "PARTIAL")] | length')
COUNT_FAILED=$(echo "$RESP"  | jq '[.data[] | select(.status == "FAILED")]  | length')
COUNT_RUNNING=$(echo "$RESP" | jq '[.data[] | select(.status == "RUNNING")] | length')
COUNT_QUEUED=$(echo "$RESP"  | jq '[.data[] | select(.status == "QUEUED")]  | length')

# ---------------------------------------------------------------------------
# Gravar report JSON
# ---------------------------------------------------------------------------
REPORT_FILE="$CUSTOMER_DIR/audit-jobs-report-$(date +%Y%m%d-%H%M%S).json"

jq -n \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg apiUrl "$API_URL" \
  --arg customerId "$CUSTOMER_ID" \
  --arg customerName "$CUSTOMER_NAME" \
  --arg statusFilter "${STATUS_FILTER:-all}" \
  --argjson total "$TOTAL" \
  --argjson done_ "$COUNT_DONE" \
  --argjson partial "$COUNT_PARTIAL" \
  --argjson failed "$COUNT_FAILED" \
  --argjson running "$COUNT_RUNNING" \
  --argjson queued "$COUNT_QUEUED" \
  --argjson jobs "$(echo "$RESP" | jq '.data')" \
  '{
    meta: {
      generatedAt: $generatedAt,
      apiUrl: $apiUrl,
      customer: { id: $customerId, name: $customerName },
      statusFilter: $statusFilter,
      totals: {
        total: $total,
        DONE: $done_,
        PARTIAL: $partial,
        FAILED: $failed,
        RUNNING: $running,
        QUEUED: $queued
      }
    },
    jobs: $jobs
  }' > "$REPORT_FILE"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "======================================="
section "  SUMMARY"
section "======================================="
echo -e "  Total jobs         : ${BOLD}$TOTAL${NC}"
echo -e "  ${GREEN}DONE${NC}               : $COUNT_DONE"
echo -e "  ${YELLOW}PARTIAL${NC}            : $COUNT_PARTIAL"
echo -e "  ${RED}FAILED${NC}             : $COUNT_FAILED"
echo -e "  ${CYAN}RUNNING${NC}            : $COUNT_RUNNING"
echo -e "  QUEUED             : $COUNT_QUEUED"
echo ""
echo -e "  Report: ${CYAN}$REPORT_FILE${NC}"
echo ""
echo -e "  ${DIM}Dica: ./audit-jobs.sh --job <jobId> --log   para ver detalhes e log completo${NC}"
section "======================================="

[[ $((COUNT_PARTIAL + COUNT_FAILED)) -gt 0 ]] && exit 2
exit 0
