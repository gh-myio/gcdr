#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento REPORT_READY para Mestre Álvaro

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"
TYPE="EMAIL_REPORT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo " EMAIL_SENDER — Simulação: REPORT_READY"
echo " Customer: Mestre Álvaro"
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
    "customer": { "id": "e04046d4-baa4-44e9-a378-4dfebe4140f1", "name": "Mestre Álvaro Engenharia" },
    "report": {
      "title":       "Relatório Mensal — Março 2026",
      "period":      "01/03/2026 a 31/03/2026",
      "generatedAt": "06/03/2026 08:00:00"
    },
    "summary": {
      "totalAlarms":   18,
      "activeDevices": 94
    },
    "items": [
      { "label": "Energia Total Consumida",  "value": "8.432 kWh" },
      { "label": "Água Total Consumida",     "value": "214 m³" },
      { "label": "Alarmes Abertos",          "value": "3" },
      { "label": "Alarmes Fechados",         "value": "15" },
      { "label": "Dispositivos Offline",     "value": "2" },
      { "label": "Uptime Médio dos Ativos",  "value": "99.1%" }
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
echo " Destinatários: rodrigo@myio.com.br, gestor@mestrealvaro.com.br"
echo " Próximo passo: SMTP.send(to[], html)"
echo "========================================"

OUTPUT_FILE="${OUTPUT_DIR}/report-email-mestrealvaro.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
