#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento ALARM_OPENED para Moxuara

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="84e0370e-636a-4741-9874-504b5e0b3577"
TYPE="EMAIL_ALARM"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo " EMAIL_SENDER — Simulação: ALARM_OPENED"
echo " Customer: Moxuara"
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
    "customer": { "id": "84e0370e-636a-4741-9874-504b5e0b3577", "name": "Moxuara" },
    "summary": {
      "rulesCount": 2,
      "devicesCount": 3,
      "alarmStatus": "OPENED"
    },
    "gateway": {
      "name": "CentralMoxuara",
      "type": "MESSAGE_GATEWAY"
    },
    "rules": [
      {
        "name": "Temperatura Elevada — Sala de Máquinas",
        "description": "Temperatura acima do limite operacional",
        "condition": "Valor > 75",
        "emails": "operacao@moxuara.com.br, rodrigo@myio.com.br",
        "devices": [
          { "name": "Sensor Temp SM-01", "value": "78", "status": "online", "timestamp": "07/03/2026 10:22:00" },
          { "name": "Sensor Temp SM-02", "value": "81", "status": "online", "timestamp": "07/03/2026 10:22:00" }
        ]
      },
      {
        "name": "Pressão Fora do Range — Linha Hidráulica",
        "description": "Pressão abaixo do mínimo seguro",
        "condition": "Valor < 2.5",
        "emails": "operacao@moxuara.com.br",
        "devices": [
          { "name": "Pressostato LH-03", "value": "2.1", "status": "online", "timestamp": "07/03/2026 10:22:00" }
        ]
      }
    ]
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
echo " Destinatários:"
echo "  operacao@moxuara.com.br"
echo "  rodrigo@myio.com.br"
echo " Próximo passo: SMTP.send(to, html)"
echo "========================================"

OUTPUT_FILE="${OUTPUT_DIR}/alarm-email-moxuara.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
