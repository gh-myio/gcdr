#!/bin/bash
# =============================================================================
# raio-x.sh — Snapshot completo do banco via API GCDR
# Busca: template-types, templates, themes, customers
#
# Uso:
#   ./raio-x.sh
#   GCDR_API_URL=https://gcdr-api.a.myio-bas.com ./raio-x.sh
#   GCDR_API_URL=https://gcdr-api.a.myio-bas.com GCDR_API_KEY=gcdr_pk_... ./raio-x.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ -f "$SCRIPT_DIR/config.env" ]] && source "$SCRIPT_DIR/config.env"

API_URL="${GCDR_API_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_myio_tenant_bundle_key_2026}"

# ─── Colors ──────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SEP="════════════════════════════════════════════════════════════"

gcdr_get() {
  curl -s "$API_URL/api/v1$1" \
    -H "X-API-Key: $API_KEY" \
    -H "Accept: application/json"
}

section() {
  echo ""
  echo -e "${BOLD}${CYAN}${SEP}${NC}"
  echo -e "${BOLD}${CYAN}  $1${NC}"
  echo -e "${BOLD}${CYAN}${SEP}${NC}"
}

# ─── Header ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  GCDR Raio-X — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "  URL: ${CYAN}$API_URL${NC}"

# ─── Template Types ──────────────────────────────────────────────────────────
section "TEMPLATE TYPES"
gcdr_get "/template-types" \
  | jq '.data.items[] | { type, label, active, sortOrder }'

# ─── Templates ───────────────────────────────────────────────────────────────
section "TEMPLATES"
gcdr_get "/templates" \
  | jq '.data.items[] | { slug, type, status, version, scope, updatedAt }'

# ─── Themes ──────────────────────────────────────────────────────────────────
section "THEMES"
gcdr_get "/themes?pageSize=100" \
  | jq '.data.items[] | { id, name, customerId, isDefault, status, updatedAt }'

# ─── Customers ───────────────────────────────────────────────────────────────
section "CUSTOMERS"
gcdr_get "/customers?pageSize=100" \
  | jq '.data.items[] | { id, name, type, status }'

echo ""
echo -e "${BOLD}${CYAN}${SEP}${NC}"
echo -e "${BOLD}  Raio-X concluído.${NC}"
echo -e "${BOLD}${CYAN}${SEP}${NC}"
echo ""
