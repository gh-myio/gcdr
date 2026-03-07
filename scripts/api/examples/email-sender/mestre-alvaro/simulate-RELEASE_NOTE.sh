#!/bin/bash
# Simula o EMAIL_SENDER recebendo um evento RELEASE_NOTE para Mestre Álvaro

BASE_URL="${GCDR_URL:-https://gcdr-api.a.myio-bas.com}"
API_KEY="${GCDR_API_KEY:-gcdr_alarm_integration_key_2026}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"
TYPE="RELEASE_NOTE"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"
mkdir -p "$OUTPUT_DIR"

echo "========================================"
echo " EMAIL_SENDER — Simulação: RELEASE_NOTE"
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
    "platform":            { "name": "MYIO", "url": "https://app.myio.com.br" },
    "version":             "v0.1.428",
    "period":              "Março 2026",
    "moduleName":          "Módulo de Energia",
    "featureTitle":        "Exportação de Dados em PDF, XLS e CSV",
    "featureSubtitle":     "Disponível no topo de cada painel de monitoramento",
    "overviewText":        "O MYIO agora permite exportar os dados de qualquer painel diretamente para PDF, planilha XLS ou arquivo CSV. O recurso está disponível para todos os usuários com permissão de leitura.",
    "highlightPanelLabel": "Coluna Área Comum — 69 dispositivos",
    "highlightMetric":     "48.932 MWh",
    "formats": [
      { "label": "PDF", "description": "Relatório visual com layout formatado e logo do cliente" },
      { "label": "XLS", "description": "Planilha editável com dados brutos e fórmulas" },
      { "label": "CSV", "description": "Arquivo texto para integração com outros sistemas" }
    ],
    "panels": [
      { "name": "Área Comum",    "deviceCount": "69" },
      { "name": "Bloco A — P1", "deviceCount": "24" },
      { "name": "Bloco B — P1", "deviceCount": "18" }
    ],
    "steps": [
      { "number": "1", "text": "Acesse o painel desejado no menu lateral" },
      { "number": "2", "text": "Clique no ícone de exportação no canto superior direito" },
      { "number": "3", "text": "Escolha o formato (PDF, XLS ou CSV) e confirme" }
    ],
    "highlights": [
      { "label": "CHILLER 1",       "value": "12.429 MWh", "description": "25.4% do total" },
      { "label": "TORRE DE RESFR",  "value": "8.103 MWh",  "description": "16.6% do total" },
      { "label": "ILUMINAÇÃO EXT",  "value": "4.211 MWh",  "description": "8.6% do total" }
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
echo " Destinatários: todos os usuários ativos do customer"
echo " Próximo passo: SMTP.send(to[], html)"
echo "========================================"

OUTPUT_FILE="${OUTPUT_DIR}/release-note-email-mestrealvaro.html"
echo "$HTML" > "$OUTPUT_FILE"
echo " HTML salvo em: $OUTPUT_FILE"
