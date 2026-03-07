#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento REPORT_READY para Moxuara

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="84e0370e-636a-4741-9874-504b5e0b3577"
TYPE="EMAIL_REPORT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo " EMAIL_SENDER — Simulação: REPORT_READY"
echo " Customer: Moxuara"
echo "========================================"

echo ""
echo "[1/2] GET /templates/render?type=${TYPE}&customerId=${CUSTOMER_ID}"

RENDER_RESPONSE=$(curl -s -X GET \
  "${BASE_URL}/api/v1/templates/render?type=${TYPE}&customerId=${CUSTOMER_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-Id: ${TENANT_ID}")

SLUG=$(echo "$RENDER_RESPONSE" | jq -r '.data.template.slug')
THEME_SOURCE=$(echo "$RENDER_RESPONSE" | jq -r '.data.themeSource')

echo "  slug:        $SLUG"
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
    "report": {
      "title":       "Relatório Mensal — Março 2026",
      "period":      "01/03/2026 a 31/03/2026",
      "generatedAt": "07/03/2026 08:00:00"
    },
    "summary": {
      "totalAlarms":   7,
      "activeDevices": 38
    },
    "items": [
      { "label": "Energia Total Consumida",  "value": "3.218 kWh" },
      { "label": "Água Total Consumida",     "value": "89 m³" },
      { "label": "Alarmes Abertos",          "value": "1" },
      { "label": "Alarmes Fechados",         "value": "6" },
      { "label": "Dispositivos Offline",     "value": "0" },
      { "label": "Uptime Médio dos Ativos",  "value": "99.7%" }
    ]
  }
}'

PREVIEW_RESPONSE=$(curl -s -X POST \
  "${BASE_URL}/api/v1/templates/${SLUG}/preview" \
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
echo " Destinatários: rodrigo@myio.com.br, gestor@moxuara.com.br"
echo " Próximo passo: SMTP.send(to[], html)"
echo "========================================"

OUTPUT_FILE="${OUTPUT_DIR}/report-email-moxuara.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
