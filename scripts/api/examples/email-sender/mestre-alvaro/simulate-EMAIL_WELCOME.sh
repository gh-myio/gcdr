#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento NEW_USER para Mestre Álvaro
#
# Fluxo:
#   1. GCDR cria novo usuário e dispara o evento NEW_USER
#   2. EMAIL_SENDER chama GET /templates/render para obter HTML com theme
#   3. Chama POST /templates/:slug/preview com os dados do usuário
#   4. HTML final pronto para envio via SMTP

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"
TYPE="EMAIL_WELCOME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo " EMAIL_SENDER — Simulação: NEW_USER"
echo " Customer: Mestre Álvaro"
echo "========================================"

echo ""
echo "[1/2] GET /templates/render?type=${TYPE}&customerId=${CUSTOMER_ID}"

RENDER_RESPONSE=$(curl -s -X GET \
  "${BASE_URL}/api/v1/templates/render?type=${TYPE}&customerId=${CUSTOMER_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-Id: ${TENANT_ID}")

SLUG=$(echo "$RENDER_RESPONSE" | jq -r '.data.template.slug')
VERSION=$(echo "$RENDER_RESPONSE" | jq -r '.data.template.version')
THEME_SOURCE=$(echo "$RENDER_RESPONSE" | jq -r '.data.themeSource')

echo "  slug:        $SLUG"
echo "  version:     $VERSION"
echo "  themeSource: $THEME_SOURCE"

if [ "$SLUG" = "null" ] || [ -z "$SLUG" ]; then
  echo "ERRO: Template não encontrado para type=${TYPE}"
  echo "$RENDER_RESPONSE" | jq '.'
  exit 1
fi

echo ""
echo "[2/2] POST /templates/${SLUG}/preview"

PAYLOAD='{
  "data": {
    "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
    "customer": { "id": "e04046d4-baa4-44e9-a378-4dfebe4140f1", "name": "Mestre Álvaro Engenharia" },
    "user": {
      "name":  "Carlos Eduardo Ferreira",
      "email": "carlos.ferreira@mestrealvaro.com.br"
    },
    "activation": {
      "link":      "https://app.myio.com.br/activate?token=eyJhbGciOiJIUzI1NiJ9.abc123",
      "expiresAt": "08/03/2026 18:00:00"
    }
  }
}'

PREVIEW_RESPONSE=$(curl -s -X POST \
  "${BASE_URL}/api/v1/templates/${SLUG}/preview?customerId=${CUSTOMER_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTML=$(echo "$PREVIEW_RESPONSE" | jq -r '.data.html')

if [ "$HTML" = "null" ] || [ -z "$HTML" ]; then
  echo "ERRO no preview:"
  echo "$PREVIEW_RESPONSE" | jq '.'
  exit 1
fi

echo "  HTML renderizado: ${#HTML} bytes"
echo ""
echo "========================================"
echo " Destinatário: carlos.ferreira@mestrealvaro.com.br"
echo " Próximo passo: SMTP.send(to, html)"
echo "========================================"

OUTPUT_FILE="${OUTPUT_DIR}/welcome-email-mestrealvaro.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
