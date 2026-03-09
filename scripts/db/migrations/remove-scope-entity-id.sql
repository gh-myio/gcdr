-- =============================================================================
-- MIGRATION: Remove scope_entity_id (singular) — unify scope into scope_entity_ids[]
--
-- Contexto:
--   scope_entity_id era redundante: para DEVICE com 1 entity continha o mesmo
--   UUID que scope_entity_ids[0]. Para CUSTOMER/ASSET, scope_entity_ids ficava
--   vazio e o UUID ficava apenas no singular.
--
--   Após esta migration, scope_entity_ids[] é a única fonte de verdade.
--
-- Aplicar em prod:
--   psql $DATABASE_URL -f scripts/db/migrations/remove-scope-entity-id.sql
-- =============================================================================

BEGIN;

-- STEP 1: Copiar scope_entity_id para scope_entity_ids onde o array está vazio
UPDATE rules
SET scope_entity_ids = ARRAY[scope_entity_id]
WHERE scope_type != 'GLOBAL'
  AND scope_entity_id IS NOT NULL
  AND (scope_entity_ids IS NULL OR scope_entity_ids = '{}');

-- STEP 2: Verificar integridade antes de remover a coluna
DO $$
DECLARE
  broken_count INT;
BEGIN
  SELECT COUNT(*) INTO broken_count
  FROM rules
  WHERE scope_type != 'GLOBAL'
    AND (scope_entity_ids IS NULL OR cardinality(scope_entity_ids) = 0);

  IF broken_count > 0 THEN
    RAISE EXCEPTION 'Migration aborted: % non-GLOBAL rules still have empty scope_entity_ids', broken_count;
  END IF;

  RAISE NOTICE 'Integrity check passed. Proceeding to drop column.';
END $$;

-- STEP 3: Remover check constraint antiga (usa scope_entity_id)
ALTER TABLE rules DROP CONSTRAINT IF EXISTS valid_scope_entity;

-- STEP 4: Remover coluna
ALTER TABLE rules DROP COLUMN IF EXISTS scope_entity_id;

-- STEP 5: Adicionar nova check constraint usando scope_entity_ids
ALTER TABLE rules ADD CONSTRAINT valid_scope_entity
  CHECK (scope_type = 'GLOBAL' OR cardinality(scope_entity_ids) > 0);

-- STEP 6: Garantir NOT NULL + default no array
ALTER TABLE rules ALTER COLUMN scope_entity_ids SET NOT NULL;
ALTER TABLE rules ALTER COLUMN scope_entity_ids SET DEFAULT '{}';

-- STEP 7: Verificação final
SELECT
  scope_type,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE cardinality(scope_entity_ids) > 0) AS with_ids,
  COUNT(*) FILTER (WHERE cardinality(scope_entity_ids) = 0) AS without_ids
FROM rules
GROUP BY scope_type
ORDER BY scope_type;

COMMIT;
