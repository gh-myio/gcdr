-- =============================================================================
-- OPS: Metrópole Ananindeua — Criar central com ID correto (Node-RED)
-- =============================================================================
-- O Node-RED envia o ID d3202744 mas o GCDR tem a central cadastrada com
-- o ID 7ac0ac44. Esse script insere a central com o ID correto copiando
-- os dados da central existente, e depois remove a antiga.
--
-- ID Node-RED (correto) : d3202744-05dd-46d1-af33-495e9a2ecd52
-- ID GCDR atual (errado): 7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a
-- Customer              : c4030d78-1cf4-4bf6-8eed-c12b4e7c281a (Metrópole Ananindeua)
-- Asset                 : 67b27a26-127e-4299-86d5-ea87cbabd665 (Central Metrópole Ananindeua Asset)
-- Tenant                : 11111111-1111-1111-1111-111111111111
-- =============================================================================

-- =============================================================================
-- Step 0 — Diagnose: distribuição de central_id nos devices do customer
-- =============================================================================
SELECT
  d.central_id,
  c.name AS central_name,
  COUNT(*) AS device_count
FROM devices d
LEFT JOIN centrals c ON c.id = d.central_id
WHERE d.customer_id = 'c4030d78-1cf4-4bf6-8eed-c12b4e7c281a'
GROUP BY d.central_id, c.name
ORDER BY device_count DESC;

-- =============================================================================
-- Step 1 — Insert central with correct Node-RED ID (copy from existing)
-- =============================================================================
INSERT INTO centrals (
  id,
  tenant_id,
  customer_id,
  asset_id,
  name,
  display_name,
  serial_number,
  type,
  status,
  connection_status,
  firmware_version,
  software_version,
  config,
  stats,
  location,
  tags,
  metadata,
  version
)
SELECT
  'd3202744-05dd-46d1-af33-495e9a2ecd52',
  tenant_id,
  customer_id,
  asset_id,
  name,
  display_name,
  serial_number,
  type,
  status,
  connection_status,
  firmware_version,
  software_version,
  config,
  stats,
  location,
  tags,
  metadata,
  version
FROM centrals
WHERE id = '7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Step 2 — Update devices: point to new central ID
-- =============================================================================
UPDATE devices
SET central_id = 'd3202744-05dd-46d1-af33-495e9a2ecd52'
WHERE central_id = '7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a'
  AND customer_id = 'c4030d78-1cf4-4bf6-8eed-c12b4e7c281a';

-- =============================================================================
-- Step 3 — Delete old central
-- =============================================================================
DELETE FROM centrals
WHERE id = '7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a';

-- =============================================================================
-- Verify
-- =============================================================================
SELECT
  id,
  name,
  serial_number,
  type,
  status,
  connection_status
FROM centrals
WHERE id IN (
  'd3202744-05dd-46d1-af33-495e9a2ecd52',
  '7ac0ac44-e631-4b64-ac1d-e9e93fe61e0a'
);

SELECT
  d.central_id,
  c.name AS central_name,
  COUNT(*) AS device_count
FROM devices d
LEFT JOIN centrals c ON c.id = d.central_id
WHERE d.customer_id = 'c4030d78-1cf4-4bf6-8eed-c12b4e7c281a'
GROUP BY d.central_id, c.name
ORDER BY device_count DESC;
