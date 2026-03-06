#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento ALARM_OPENED para Mestre Álvaro
#
# Fluxo:
#   1. EMAIL_SENDER recebe o payload do ALARMS-API
#   2. Chama GET /templates/render para obter o HTML com theme do customer
#   3. Chama POST /templates/:slug/preview com os dados do alarme
#   4. HTML final pronto para envio via SMTP

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"
TYPE="EMAIL_ALARM"

echo "========================================"
echo " EMAIL_SENDER — Simulação: ALARM_OPENED"
echo " Customer: Mestre Álvaro"
echo "========================================"

# ------------------------------------------------------------------
# STEP 1: Buscar template com theme do customer
# ------------------------------------------------------------------
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

# ------------------------------------------------------------------
# STEP 2: Renderizar com dados reais do alarme (conteúdo do evento)
# ------------------------------------------------------------------
echo ""
echo "[2/2] POST /templates/${SLUG}/preview"

PAYLOAD='{
  "data": {
    "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
    "customer": { "id": "e04046d4-baa4-44e9-a378-4dfebe4140f1", "name": "Mestre Álvaro Engenharia" },
    "summary": {
      "rulesCount": 3,
      "devicesCount": 5,
      "alarmStatus": "OPENED"
    },
    "gateway": {
      "name": "MessageGatewayMestreAlvaro",
      "type": "MESSAGE_GATEWAY"
    },
    "rules": [
      {
        "name": "Fancoil Ligado Fora do Horario (Seg - Dom)",
        "description": "Fancoil permanece ligado fora do horario permitido de operacao",
        "condition": "Valor == 1",
        "emails": "rodrigo@myio.com.br, victor@myio.com.br",
        "devices": [
          { "name": "Fancoil Sala Reuniao 01",  "value": "1", "status": "online", "timestamp": "06/03/2026 22:14:00" },
          { "name": "Fancoil Sala Reuniao 02",  "value": "1", "status": "online", "timestamp": "06/03/2026 22:14:00" },
          { "name": "Fancoil Corredor Leste",   "value": "1", "status": "online", "timestamp": "06/03/2026 22:14:00" }
        ]
      },
      {
        "name": "Temperatura Elevada - Elevador",
        "description": "Temperatura do motor do elevador acima do limite configurado",
        "condition": "Valor > 80",
        "emails": "rodrigo@myio.com.br",
        "devices": [
          { "name": "Elevador Torre A - Motor Principal", "value": "85", "status": "online", "timestamp": "06/03/2026 22:14:00" },
          { "name": "Elevador Torre B - Motor Principal", "value": "91", "status": "online", "timestamp": "06/03/2026 22:14:00" }
        ]
      }
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
echo " Destinatários (extraídos do payload):"
echo "  rodrigo@myio.com.br"
echo "  victor@myio.com.br"
echo " Próximo passo: SMTP.send(to, html)"
echo "========================================"

# Salvar HTML para inspeção
OUTPUT_FILE="/tmp/alarm-email-mestrealvaro.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
