#!/bin/bash
# Fetch simplified alarm bundle for Shopping Plaza Macaé and save to JSON file
# Customer: Shopping Plaza Macaé (8eccc220-f647-11f0-998e-25174baff087)
#           (UUID encontrado em logs/025-logEditAsset.log — dump de resposta da API prod)
# Central:  sem filtro — retorna todos os devices do customer
# Para filtrar por central use: fetch-simple-bundle-central.sh
#
# Env vars (todas opcionais, com defaults):
#   API_URL      — default: https://gcdr-api.a.myio-bas.com
#   CUSTOMER_ID  — default: UUID do Shopping Plaza Macaé
#   API_KEY      — default: chave genérica de integração (mesmo esquema do montserrat_test)
#   CENTRAL_ID   — filtra por central via header X-Central-Id (vazio = todos)

#API_URL="http://localhost:3015"
# Credenciais locais (nao versionadas — .gitignore cobre .env.*)
ENV_FILE="$(dirname "$0")/.env.macae"
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

API_URL="${API_URL:-https://gcdr-api.a.myio-bas.com}"
CUSTOMER_ID="${CUSTOMER_ID:-8eccc220-f647-11f0-998e-25174baff087}"
API_KEY="${API_KEY:-gcdr_alarm_integration_key_2026}"
CENTRAL_ID="${CENTRAL_ID:-}"
OUTPUT_FILE="$(dirname "$0")/simple_bundle_output.json"

echo "Fetching simplified bundle — Shopping Plaza Macaé..."
echo "Customer: $CUSTOMER_ID"
echo "Central:  ${CENTRAL_ID:-<todos>}"
echo "API key:  ${API_KEY:0:8}********** (mascarada)"
echo ""

curl -s "${API_URL}/api/v1/customers/${CUSTOMER_ID}/alarm-rules/bundle/simple" \
  -H "X-API-Key: ${API_KEY}" \
  ${CENTRAL_ID:+-H "X-Central-Id: ${CENTRAL_ID}"} \
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
