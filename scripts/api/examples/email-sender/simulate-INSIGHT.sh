#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento INSIGHT para Mestre Álvaro

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"
TYPE="INSIGHT"

echo "========================================"
echo " EMAIL_SENDER — Simulação: INSIGHT"
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
    "insight": {
      "title":   "Resumo de Consumo — Março 2026",
      "period":  "01/03/2026 a 31/03/2026",
      "summary": "O consumo de energia aumentou 8% em relação a fevereiro, puxado principalmente pelo uso do ar-condicionado central nos finais de semana. O consumo de água se manteve estável."
    },
    "metrics": [
      { "label": "Energia Total",    "value": "8.432",  "unit": "kWh", "trend": "UP" },
      { "label": "Demanda Máxima",   "value": "42.8",   "unit": "kW",  "trend": "UP" },
      { "label": "Água Total",       "value": "214",    "unit": "m³",  "trend": "STABLE" },
      { "label": "Custo Estimado",   "value": "R$ 6.190","unit": "",   "trend": "UP" }
    ],
    "recommendations": [
      {
        "title": "Desligar ar-condicionado central aos finais de semana",
        "text":  "Identificamos consumo elevado de energia nos sábados e domingos entre 14h e 19h sem ocupação registrada. Programar o desligamento automático pode reduzir até 12% do consumo mensal."
      },
      {
        "title": "Verificar bomba de recirculação de água — Subsolo B1",
        "text":  "A bomba registrou 47 ciclos acima do padrão em março. Recomendamos inspeção preventiva para evitar paradas não programadas."
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
echo " Destinatários: rodrigo@myio.com.br, gestor@mestrealvaro.com.br"
echo " Próximo passo: SMTP.send(to[], html)"
echo "========================================"

OUTPUT_FILE="/tmp/insight-email-mestrealvaro.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
