-- =============================================================================
-- fix-identifier-unique-constraint.sql
-- Remove unique constraint (tenant_id, identifier) da tabela devices.
--
-- Contexto: RFC-0008 projetou identifier como chave lógica única por tenant
-- (ex: "ENTRADA_SHOPPING_GARAGEM_L2"). Na prática, identifier é um código de
-- registro Modbus (ex: "CAG", "TEMPERATURA") que se repete em dispositivos de
-- diferentes centrais/slaves dentro do mesmo tenant.
--
-- A unicidade real é garantida por devices_tenant_central_slave_unique:
--   UNIQUE (tenant_id, central_id, slave_id)
--
-- O índice não-único devices_identifier_idx é mantido para performance de lookup.
--
-- Uso:  npm run db:ops scripts/db/migrations/fix-identifier-unique-constraint.sql
-- =============================================================================

-- Drop the over-restrictive unique constraint
DROP INDEX IF EXISTS devices_tenant_identifier_unique;

-- Verify: the regular index still exists for lookup performance
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'devices'
  AND indexname IN ('devices_identifier_idx', 'devices_tenant_identifier_unique');
