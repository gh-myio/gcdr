-- =============================================================================
-- OPS: Rio Poty — Criar central com ID correto
-- =============================================================================
-- A central antiga (1817cd70) foi deletada. Este script insere diretamente
-- a central com o ID correto do gateway real.
--
-- ID correto : c0af8288-7b13-4024-bc11-df5017fef656
-- Customer   : 8f9af056-10c2-4cd4-a45f-ab0c99377aca (Rio Poty)
-- Asset      : bccbaab6-7f93-4735-8e33-29214018fc9d
-- Tenant     : 11111111-1111-1111-1111-111111111111
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
) VALUES (
  'c0af8288-7b13-4024-bc11-df5017fef656',
  '11111111-1111-1111-1111-111111111111',
  '8f9af056-10c2-4cd4-a45f-ab0c99377aca',
  'bccbaab6-7f93-4735-8e33-29214018fc9d',
  'Central Rio Poty',
  'Central Rio Poty',
  'SCRPGATEWAY01',
  'GATEWAY',
  'ACTIVE',
  'OFFLINE',
  '1.0.0',
  '1.0.0',
  '{}',
  '{}',
  '{}',
  '[]',
  '{}',
  1
)
ON CONFLICT DO NOTHING;

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
WHERE id = 'c0af8288-7b13-4024-bc11-df5017fef656';

SELECT COUNT(*) AS devices_linked
FROM devices
WHERE central_id = 'c0af8288-7b13-4024-bc11-df5017fef656';
