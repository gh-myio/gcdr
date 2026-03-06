#!/bin/bash
# GET /templates/render — type: NOTIFICATION
# Customer: Mestre Álvaro (e04046d4-baa4-44e9-a378-4dfebe4140f1)

BASE_URL="${GCDR_URL:-http://localhost:3015}"
API_KEY="${GCDR_API_KEY:-gcdr_pk_dev_local}"
TENANT_ID="${GCDR_TENANT_ID:-11111111-1111-1111-1111-111111111111}"
CUSTOMER_ID="e04046d4-baa4-44e9-a378-4dfebe4140f1"

curl -s -X GET \
  "${BASE_URL}/api/v1/templates/render?type=NOTIFICATION&customerId=${CUSTOMER_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "Content-Type: application/json" \
  | jq '{themeSource: .data.themeSource, template: .data.template, htmlPreview: (.data.html | .[0:200])}'
