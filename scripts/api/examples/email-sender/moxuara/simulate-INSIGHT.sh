#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento INSIGHT para Moxuara

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="84e0370e-636a-4741-9874-504b5e0b3577"
TYPE="INSIGHT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo " EMAIL_SENDER — Simulação: INSIGHT"
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
    "insight": {
      "title":   "Resumo de Consumo — Março 2026",
      "period":  "01/03/2026 a 31/03/2026",
      "summary": "O consumo de energia manteve-se dentro da faixa esperada. Identificamos oportunidade de redução na linha hidráulica, que apresentou pressão elevada em períodos de baixa demanda."
    },
    "metrics": [
      { "label": "Energia Total",  "value": "3.218",    "unit": "kWh", "trend": "STABLE" },
      { "label": "Demanda Máxima", "value": "18.4",     "unit": "kW",  "trend": "DOWN" },
      { "label": "Água Total",     "value": "89",        "unit": "m³",  "trend": "UP" },
      { "label": "Custo Estimado", "value": "R$ 2.340", "unit": "",    "trend": "STABLE" }
    ],
    "recommendations": [
      {
        "title": "Revisar pressão da linha hidráulica fora do horário de pico",
        "text":  "A linha LH-03 registrou pressão acima do range seguro entre 00h e 06h por 8 dias consecutivos. Recomendamos ajustar a válvula redutora para evitar desgaste prematuro."
      },
      {
        "title": "Verificar sensor de temperatura SM-01",
        "text":  "O sensor SM-01 gerou 47 alarmes em março, acima da média de 12/mês. Pode indicar necessidade de calibração ou substituição do sensor."
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
echo " Destinatários: rodrigo@myio.com.br, gestor@moxuara.com.br"
echo " Próximo passo: SMTP.send(to[], html)"
echo "========================================"

OUTPUT_FILE="${OUTPUT_DIR}/insight-email-moxuara.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
