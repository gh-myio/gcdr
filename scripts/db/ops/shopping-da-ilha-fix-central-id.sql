-- =============================================================================
-- OPS: Shopping da Ilha — Criar central com ID correto
-- =============================================================================
-- 420 devices já estão com central_id = cb318f02 mas o registro da central
-- não existe. Este script insere a central diretamente.
--
-- Central ID : cb318f02-1020-4f99-857f-d44d001d939b
-- Customer   : f1fcf434-532b-428a-a5e1-0b68e8ae1056 (Shopping da Ilha)
-- Asset      : ab734ecc-6d47-4e3c-8897-2027af2c61f3
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
  'cb318f02-1020-4f99-857f-d44d001d939b',
  '11111111-1111-1111-1111-111111111111',
  'f1fcf434-532b-428a-a5e1-0b68e8ae1056',
  'ab734ecc-6d47-4e3c-8897-2027af2c61f3',
  'Central Shopping da Ilha',
  'Central Shopping da Ilha',
  'SCSDILHAGATEWAY01',
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
WHERE id = 'cb318f02-1020-4f99-857f-d44d001d939b';

SELECT COUNT(*) AS devices_linked
FROM devices
WHERE central_id = 'cb318f02-1020-4f99-857f-d44d001d939b';
