-- =============================================================================
-- check-device-asset-inconsistencies.sql
-- Diagnóstico: dispositivos cujo customer_id difere do customer_id do seu asset
--
-- Uso:  npm run db:ops scripts/db/ops/check-device-asset-inconsistencies.sql
-- =============================================================================

-- 1. Dispositivos com customerId inconsistente em relação ao asset
SELECT
  d.id                  AS device_id,
  d.name                AS device_name,
  d.customer_id         AS device_customer_id,
  dc.name               AS device_customer_name,
  d.asset_id,
  a.name                AS asset_name,
  a.customer_id         AS asset_customer_id,
  ac.name               AS asset_customer_name,
  d.tenant_id
FROM devices d
JOIN assets  a  ON a.id = d.asset_id
JOIN customers dc ON dc.id = d.customer_id
JOIN customers ac ON ac.id = a.customer_id
WHERE d.asset_id IS NOT NULL
  AND d.customer_id <> a.customer_id
ORDER BY d.tenant_id, asset_customer_id, device_customer_id;

-- 2. Resumo por customer
SELECT
  a.customer_id         AS asset_customer_id,
  ac.name               AS asset_customer_name,
  d.customer_id         AS device_customer_id,
  dc.name               AS device_customer_name,
  COUNT(*)              AS inconsistent_devices
FROM devices d
JOIN assets    a  ON a.id = d.asset_id
JOIN customers ac ON ac.id = a.customer_id
JOIN customers dc ON dc.id = d.customer_id
WHERE d.asset_id IS NOT NULL
  AND d.customer_id <> a.customer_id
GROUP BY a.customer_id, ac.name, d.customer_id, dc.name
ORDER BY inconsistent_devices DESC;
