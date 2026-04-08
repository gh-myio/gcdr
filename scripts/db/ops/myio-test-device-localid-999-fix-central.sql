-- =============================================================================
-- OPS: Myio — Fix test device localId 999 — vincular central
-- =============================================================================
-- Vincula o device de teste (slave_id=999) à central Myio
-- Central: 4dbfb385-5925-4a6f-9748-af2460c95207
-- =============================================================================

UPDATE devices
SET
  central_id = '4dbfb385-5925-4a6f-9748-af2460c95207',
  updated_at = now(),
  version    = version + 1
WHERE tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND customer_id = '56614a70-326f-11ef-ad2c-53aeabe7d3fa'
  AND slave_id    = 999;

-- Verify
SELECT id, name, slave_id, central_id, status
FROM devices
WHERE tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND customer_id = '56614a70-326f-11ef-ad2c-53aeabe7d3fa'
  AND slave_id    = 999;
