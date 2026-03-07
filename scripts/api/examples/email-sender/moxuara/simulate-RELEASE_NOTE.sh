#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento RELEASE_NOTE para Moxuara

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="84e0370e-636a-4741-9874-504b5e0b3577"
TYPE="RELEASE_NOTE"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo " EMAIL_SENDER — Simulação: RELEASE_NOTE"
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
    "platform":            { "name": "MYIO", "url": "https://app.myio.com.br" },
    "version":             "v0.1.428",
    "period":              "Março 2026",
    "moduleName":          "Módulo de Alarmes",
    "featureTitle":        "Histórico de Alarmes com Filtros Avançados",
    "featureSubtitle":     "Disponível no menu Alarmes > Histórico",
    "overviewText":        "O MYIO agora permite consultar o histórico completo de alarmes com filtros por período, dispositivo, regra e status. O recurso facilita auditorias e análise de ocorrências passadas.",
    "highlightPanelLabel": "Central Moxuara — 38 dispositivos",
    "highlightMetric":     "312 alarmes registrados",
    "formats": [
      { "label": "Filtro por Período", "description": "Selecione qualquer intervalo de datas" },
      { "label": "Filtro por Regra",   "description": "Filtre pelos nomes das regras configuradas" },
      { "label": "Exportar CSV",       "description": "Baixe o histórico para análise externa" }
    ],
    "panels": [
      { "name": "Sala de Máquinas", "deviceCount": "12" },
      { "name": "Linha Hidráulica", "deviceCount": "8" },
      { "name": "Área Externa",     "deviceCount": "18" }
    ],
    "steps": [
      { "number": "1", "text": "Acesse o menu Alarmes no painel lateral" },
      { "number": "2", "text": "Clique em Histórico e selecione o período desejado" },
      { "number": "3", "text": "Aplique filtros adicionais e clique em Exportar se necessário" }
    ],
    "highlights": [
      { "label": "TEMP SM-01",    "value": "47 alarmes", "description": "Sensor mais ativo no mês" },
      { "label": "PRESS LH-03",  "value": "23 alarmes", "description": "Segundo mais ativo" },
      { "label": "RESOLVIDOS",   "value": "98.7%",       "description": "Taxa de resolução" }
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
echo " Destinatários: todos os usuários ativos do customer"
echo " Próximo passo: SMTP.send(to[], html)"
echo "========================================"

OUTPUT_FILE="${OUTPUT_DIR}/release-note-email-moxuara.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
