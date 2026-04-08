-- =============================================================================
-- OPS: Myio — Test Device localId 999
-- =============================================================================
-- Tenant  : 11111111-1111-1111-1111-111111111111
-- Customer: 56614a70-326f-11ef-ad2c-53aeabe7d3fa (Myio)
--
-- Cria um asset EQUIPMENT e um device com slave_id=999 para testes
-- do alarm backend (local_id: "999" no payload do alarm backend = slave_id no GCDR)
-- =============================================================================

DO $$
DECLARE
  v_tenant_id   UUID := '11111111-1111-1111-1111-111111111111';
  v_customer_id UUID := '56614a70-326f-11ef-ad2c-53aeabe7d3fa';
  v_asset_id    UUID := gen_random_uuid();
  v_device_id   UUID := gen_random_uuid();
BEGIN

  -- ── Asset default (EQUIPMENT) ───────────────────────────────────────────────
  INSERT INTO assets (
    id, tenant_id, customer_id,
    parent_asset_id, path, depth,
    name, display_name, code, type,
    status, version
  )
  VALUES (
    v_asset_id,
    v_tenant_id,
    v_customer_id,
    NULL,
    v_asset_id::text,   -- root asset: path = own id
    0,
    'Equipamento Teste Myio',
    'Equipamento Teste Myio',
    'myio-test-equip-999',
    'EQUIPMENT',
    'ACTIVE',
    1
  )
  ON CONFLICT (tenant_id, customer_id, code) DO NOTHING;

  -- Recupera o id caso o asset já exista (conflict)
  SELECT id INTO v_asset_id
  FROM assets
  WHERE tenant_id   = v_tenant_id
    AND customer_id = v_customer_id
    AND code        = 'myio-test-equip-999';

  -- ── Device slave_id=999 ─────────────────────────────────────────────────────
  INSERT INTO devices (
    id, tenant_id, asset_id, customer_id,
    name, display_name, label,
    type, serial_number,
    specs, connectivity_status,
    tags, metadata, attributes,
    slave_id,
    status, version
  )
  VALUES (
    v_device_id,
    v_tenant_id,
    v_asset_id,
    v_customer_id,
    'Dispositivo Teste localId 999',
    'Dispositivo Teste localId 999',
    'TEST-999',
    'SENSOR',
    'SN-TEST-MYIO-999',
    '{}',
    'UNKNOWN',
    '["teste", "alarm-backend"]',
    '{}',
    '{}',
    999,
    'ACTIVE',
    1
  );

  RAISE NOTICE 'Asset criado: % | Device criado: % (slave_id=999)', v_asset_id, v_device_id;

END $$;

-- Verify
SELECT
  d.id          AS device_id,
  d.name,
  d.slave_id,
  d.status,
  a.id          AS asset_id,
  a.name        AS asset_name,
  a.type        AS asset_type
FROM devices d
JOIN assets a ON a.id = d.asset_id
WHERE d.tenant_id   = '11111111-1111-1111-1111-111111111111'
  AND d.customer_id = '56614a70-326f-11ef-ad2c-53aeabe7d3fa'
  AND d.slave_id    = 999;
