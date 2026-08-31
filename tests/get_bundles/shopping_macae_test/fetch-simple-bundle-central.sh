#!/bin/bash
# Fetch simplified alarm bundle — Shopping Plaza Macaé / uma central específica
# Customer: Shopping Plaza Macaé (8eccc220-f647-11f0-998e-25174baff087)
#           (UUID encontrado em logs/025-logEditAsset.log — dump de resposta da API prod)
# Central:  NÃO encontrada no repo — informe via env:
#   export CENTRAL_ID=<uuid da central do Shopping Plaza Macaé>
# Dica: rode fetch-simple-bundle.sh primeiro e inspecione .data.deviceIndex
# (ou GET /api/v1/centrals?customerId=...) para descobrir o UUID da central.
#
# Env vars:
#   CENTRAL_ID   (obrigatório) — UUID da central (header X-Central-Id)
#   API_URL      (opcional)    — default: https://gcdr-api.a.myio-bas.com
#   CUSTOMER_ID  (opcional)    — default: UUID do Shopping Plaza Macaé
#   API_KEY      (opcional)    — default: chave genérica de integração

#API_URL="http://localhost:3015"
# Credenciais locais (nao versionadas — .gitignore cobre .env.*)
ENV_FILE="$(dirname "$0")/.env.macae"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

API_URL="${API_URL:-https://gcdr-api.a.myio-bas.com}"
CUSTOMER_ID="${CUSTOMER_ID:-8eccc220-f647-11f0-998e-25174baff087}"
API_KEY="${API_KEY:-gcdr_alarm_integration_key_2026}"
: "${CENTRAL_ID:?export CENTRAL_ID=<uuid da central do Shopping Plaza Macaé>}"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_central.json"

echo "Fetching simplified bundle — Shopping Plaza Macaé / central..."
echo "Customer: $CUSTOMER_ID"
echo "Central:  $CENTRAL_ID"
echo "API key:  ${API_KEY:0:8}********** (mascarada)"
echo ""

curl -s "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Central-Id: ${CENTRAL_ID}" \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
  echo "Bundle saved to: $OUTPUT_FILE"
  echo ""
  echo "=== meta ==="
  jq '.data.meta' "$OUTPUT_FILE" 2>/dev/null || head -30 "$OUTPUT_FILE"
  echo ""
  echo "=== deviceIndex keys ==="
  jq '.data.deviceIndex | keys' "$OUTPUT_FILE" 2>/dev/null
  echo ""
  echo "=== rules keys ==="
  jq '.data.rules | keys' "$OUTPUT_FILE" 2>/dev/null
else
  echo "Error fetching bundle"
  exit 1
fi
