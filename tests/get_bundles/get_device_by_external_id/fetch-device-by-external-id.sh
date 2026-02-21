#!/bin/bash
# Fetch enriched device by ThingsBoard externalId
# Payload returns: device + asset + customer + rules (DEVICE-scoped)

# Configuration - Change API_URL for different environments
# Local: http://localhost:3015
# Production: https://gcdr-api.a.myio-bas.com
#API_URL="http://localhost:3015"
API_URL="https://gcdr-api.a.myio-bas.com"

# ThingsBoard Connector API Key (seeded in 13-customer-api-keys.sql)
API_KEY="gcdr_cust_tb_integration_key_2026"
TENANT_ID="11111111-1111-1111-1111-111111111111"

# Device: "Escada Rolante 1 L2"
# GCDR ID  : 6174a024-941c-4a1e-a984-b80e7a114af5
# TB Name  : 3F SCMOXUARAAC_ER1_L2
EXTERNAL_ID="24538c80-b4de-11f0-be7f-e760d1498268"

OUTPUT_FILE="$(dirname "$0")/device_enriched_output.json"

echo "Fetching enriched device by externalId..."
echo "Device     : Escada Rolante 1 L2 (3F SCMOXUARAAC_ER1_L2)"
echo "ExternalId : $EXTERNAL_ID"
echo "Tenant     : $TENANT_ID"
echo ""

curl -s "${API_URL}/api/v1/devices/external/${EXTERNAL_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -H "X-Tenant-ID: ${TENANT_ID}" \
  -H "Accept: application/json" \
  -o "$OUTPUT_FILE"

if [ $? -eq 0 ] && [ -s "$OUTPUT_FILE" ]; then
  echo "Response saved to: $OUTPUT_FILE"
  echo ""
  echo "--- Pretty print ---"
  cat "$OUTPUT_FILE" | python3 -m json.tool 2>/dev/null || cat "$OUTPUT_FILE"
else
  echo "Error fetching device"
  exit 1
fi
