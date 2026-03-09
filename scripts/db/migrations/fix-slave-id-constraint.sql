-- =============================================================================
-- fix-slave-id-constraint.sql
-- Atualiza constraint valid_slave_id para permitir slave_id até 999
-- (antes: max 247 — apenas Modbus RTU; agora: max 999 — suporta outros protocolos)
--
-- Uso:  npm run db:ops scripts/db/migrations/fix-slave-id-constraint.sql
-- =============================================================================

ALTER TABLE devices DROP CONSTRAINT IF EXISTS valid_slave_id;

ALTER TABLE devices ADD CONSTRAINT valid_slave_id
  CHECK (slave_id IS NULL OR (slave_id >= 1 AND slave_id <= 999));

-- Verificação
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'valid_slave_id';
