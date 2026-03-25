-- =============================================================================
-- OPS: Update customer metadata — Shopping Metrópole Ananindeua
--
-- Customer ID : c4030d78-1cf4-4bf6-8eed-c12b4e7c281a
-- Tenant ID   : 11111111-1111-1111-1111-111111111111
--
-- Adiciona campos ThingsBoard ao metadata (merge, não sobrescreve outros campos)
-- =============================================================================

UPDATE customers
SET
    metadata = COALESCE(metadata, '{}'::jsonb) || '{
        "tbId":         "01369a40-d6ac-11f0-998e-25174baff087",
        "tbName":       "Metrópole Ananindeua",
        "tbEntityType": "CUSTOMER"
    }'::jsonb,
    updated_at = NOW(),
    version    = version + 1
WHERE id        = 'c4030d78-1cf4-4bf6-8eed-c12b4e7c281a'
  AND tenant_id = '11111111-1111-1111-1111-111111111111';

-- Verificação
SELECT id, name, metadata, updated_at, version
FROM customers
WHERE id = 'c4030d78-1cf4-4bf6-8eed-c12b4e7c281a';
