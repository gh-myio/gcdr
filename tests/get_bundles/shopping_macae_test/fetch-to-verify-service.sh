#!/bin/bash
# Fetch enriched alarm bundle (to-verify-service) — Shopping Plaza Macaé
# Endpoint: GET /api/v1/customers/:customerId/alarm-rules/bundle/to-verify-service
#
# ATENÇÃO — AUTH: este endpoint usa authMiddleware (src/app.ts:249), que aceita:
#   1. JWT Bearer  (Authorization: Bearer <token>)
#   2. Master API key: aceita SIM (authMiddleware chama tryMasterApiKey antes do
#      Bearer — src/middleware/auth.ts:102). Um 401 "Token de acesso nao fornecido"
#      com GCDR_MASTER_KEY setada significa que a chave NAO bate com a
#      GCDR_MASTER_API_KEY do servidor alvo (ex.: .env.prod local desatualizado).
# NÃO aceita a chave de integração de bundle (gcdr_cust_* / hybridAuth) usada
# pelos outros scripts desta pasta.
#
# Formas de autenticar (em ordem de precedência):
#   a) export GCDR_JWT=<token>            — usa o token direto
#   b) export GCDR_EMAIL=... GCDR_PASSWORD=...
#      → o script faz login automático via POST /api/v1/auth/login
#        (mesmo fluxo de scripts/api/audit-jobs/audit-jobs.sh)
#   c) export GCDR_MASTER_KEY=<master key> [GCDR_TENANT_ID=<uuid>]
#      → usa X-API-Key master (acesso total ao tenant)
#
# Env vars:
#   GCDR_JWT / GCDR_EMAIL+GCDR_PASSWORD / GCDR_MASTER_KEY — auth (uma das três, obrigatório)
#   GCDR_TENANT_ID — tenant p/ master key (default: 11111111-1111-1111-1111-111111111111)
#   API_URL        — default: https://gcdr-api.a.myio-bas.com
#   CUSTOMER_ID    — default: UUID do Shopping Plaza Macaé (de logs/025-logEditAsset.log)
#   CENTRAL_ID     — opcional, header X-Central-Id
#   VERSION_ID     — opcional, header X-Version-Id (demonstra o fluxo 304 como em
#                    fetch-with-version-check.sh; obs.: o handler atual do
#                    to-verify-service NÃO implementa short-circuit de versão —
#                    hoje sempre responde 200 com o bundle completo; o header é
#                    enviado para documentar/testar o contrato)

#API_URL="http://localhost:3015"
# Credenciais locais (nao versionadas — .gitignore cobre .env.*)
ENV_FILE="$(dirname "$0")/.env.macae"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

API_URL="${API_URL:-https://gcdr-api.a.myio-bas.com}"
CUSTOMER_ID="${CUSTOMER_ID:-8eccc220-f647-11f0-998e-25174baff087}"
CENTRAL_ID="${CENTRAL_ID:-}"
VERSION_ID="${VERSION_ID:-}"
OUTPUT_FILE="$(dirname "$0")/to_verify_service_output.json"

# ─────────────────────────────────────────────────────────────
# Resolve auth header (JWT direto → login automático → master key)
# ─────────────────────────────────────────────────────────────
AUTH_HEADER=""
EXTRA_HEADER=""

if [ -n "$GCDR_JWT" ]; then
  AUTH_HEADER="Authorization: Bearer ${GCDR_JWT}"
  echo "Auth: JWT via env GCDR_JWT (token mascarado: ${GCDR_JWT:0:12}...)"
elif [ -n "$GCDR_EMAIL" ] && [ -n "$GCDR_PASSWORD" ]; then
  echo "Auth: login automático como $GCDR_EMAIL ..."
  LOGIN=$(curl -s -X POST "${API_URL}/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${GCDR_EMAIL}\",\"password\":\"${GCDR_PASSWORD}\"}")
  if command -v jq &>/dev/null; then
    JWT_TOKEN=$(echo "$LOGIN" | jq -r '.data.accessToken // .accessToken // empty')
  else
    JWT_TOKEN=$(echo "$LOGIN" | grep -o '"accessToken" *: *"[^"]*"' | head -1 | sed 's/.*: *"//; s/"$//')
  fi
  if [ -z "$JWT_TOKEN" ]; then
    echo "ERRO: login falhou (token não retornado). Verifique GCDR_EMAIL/GCDR_PASSWORD." >&2
    exit 1
  fi
  AUTH_HEADER="Authorization: Bearer ${JWT_TOKEN}"
  echo "Auth: JWT obtido via login (token mascarado: ${JWT_TOKEN:0:12}...)"
elif [ -n "$GCDR_MASTER_KEY" ]; then
  AUTH_HEADER="X-API-Key: ${GCDR_MASTER_KEY}"
  EXTRA_HEADER="X-Tenant-Id: ${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
  echo "Auth: master API key via env GCDR_MASTER_KEY (mascarada: ${GCDR_MASTER_KEY:0:8}...)"
else
  cat >&2 <<'EOF'
ERRO: nenhuma credencial encontrada. O endpoint to-verify-service exige JWT
(ou master key) — a X-API-Key de bundle dos outros scripts NÃO funciona aqui.

Use UMA das opções:
  export GCDR_JWT=<jwt>                                  # token pronto
  export GCDR_EMAIL=<email> GCDR_PASSWORD=<senha>        # login automático
  export GCDR_MASTER_KEY=<master key> [GCDR_TENANT_ID=<uuid>]
EOF
  exit 1
fi

echo ""
echo "Fetching to-verify-service bundle — Shopping Plaza Macaé..."
echo "Customer:   $CUSTOMER_ID"
echo "Central:    ${CENTRAL_ID:-<todos>}"
echo "Version-Id: ${VERSION_ID:-<nenhum>}"
echo ""

HTTP_CODE=$(curl -s --max-time 120 -w "%{http_code}" \
  "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/to-verify-service" \
  -H "$AUTH_HEADER" \
  ${EXTRA_HEADER:+-H "$EXTRA_HEADER"} \
  ${CENTRAL_ID:+-H "X-Central-Id: ${CENTRAL_ID}"} \
  ${VERSION_ID:+-H "X-Version-Id: ${VERSION_ID}"} \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE")

echo "HTTP status: $HTTP_CODE"

if [ "$HTTP_CODE" = "304" ]; then
  echo "304 Not Modified — bundle não mudou desde VERSION_ID=${VERSION_ID}"
  exit 0
fi

if [ "$HTTP_CODE" != "200" ] || [ ! -s "$OUTPUT_FILE" ]; then
  echo "Error fetching to-verify-service bundle"
  [ -s "$OUTPUT_FILE" ] && head -20 "$OUTPUT_FILE"
  exit 1
fi

echo "Bundle saved to: $OUTPUT_FILE"
echo ""

if command -v jq &>/dev/null; then
  echo "=== resumo ==="
  echo "versionId:               $(jq -r '.data.versionId // "N/A"' "$OUTPUT_FILE")"
  echo "rules count:             $(jq '.data.rules | length' "$OUTPUT_FILE")"
  echo "noConsumptionRules count: $(jq '.data.noConsumptionRules // [] | length' "$OUTPUT_FILE")"
  echo "devices (deviceIndex):   $(jq '.data.deviceIndex | length' "$OUTPUT_FILE")"
  echo ""
  echo "=== rules keys ==="
  jq '.data.rules | keys' "$OUTPUT_FILE"
  echo ""
  echo "=== noConsumptionRules ids ==="
  jq '[.data.noConsumptionRules // [] | .[] | .id // .ruleId]' "$OUTPUT_FILE"
else
  echo "(jq não instalado — resumo aproximado via grep)"
  echo "rules occurrences:              $(grep -o '"rules"' "$OUTPUT_FILE" | wc -l)"
  echo "noConsumptionRules occurrences: $(grep -o '"noConsumptionRules"' "$OUTPUT_FILE" | wc -l)"
  echo "Payload size: $(wc -c < "$OUTPUT_FILE") bytes"
  echo "Instale jq para contagens exatas de rules[] e noConsumptionRules[]."
fi
