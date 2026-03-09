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
-- Idempotente: seguro rodar mesmo se a coluna já foi removida.
--
-- Aplicar em prod:
--   psql $DATABASE_URL -f scripts/db/migrations/remove-scope-entity-id.sql
-- =============================================================================

DO $$
DECLARE
  col_exists   BOOLEAN;
  broken_count INT;
BEGIN
  -- Verifica se scope_entity_id ainda existe
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rules' AND column_name = 'scope_entity_id'
  ) INTO col_exists;

  IF col_exists THEN
    RAISE NOTICE 'scope_entity_id encontrado — copiando para scope_entity_ids...';

    -- STEP 1: Copiar para o array onde ainda está vazio
    UPDATE rules
    SET scope_entity_ids = ARRAY[scope_entity_id]
    WHERE scope_type != 'GLOBAL'
      AND scope_entity_id IS NOT NULL
      AND (scope_entity_ids IS NULL OR scope_entity_ids = '{}');

    -- STEP 2: Verificar integridade
    SELECT COUNT(*) INTO broken_count
    FROM rules
    WHERE scope_type != 'GLOBAL'
      AND (scope_entity_ids IS NULL OR cardinality(scope_entity_ids) = 0);

    IF broken_count > 0 THEN
      RAISE EXCEPTION 'Migration aborted: % non-GLOBAL rules still have empty scope_entity_ids', broken_count;
    END IF;

    -- STEP 3: Drop constraint antiga (referencia scope_entity_id)
    ALTER TABLE rules DROP CONSTRAINT IF EXISTS valid_scope_entity;

    -- STEP 4: Drop coluna
    ALTER TABLE rules DROP COLUMN scope_entity_id;

    RAISE NOTICE 'scope_entity_id removido com sucesso.';
  ELSE
    RAISE NOTICE 'scope_entity_id já não existe — pulando steps 1-4.';
  END IF;

  -- STEP 5: Garantir constraint correta (idempotente)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'rules' AND constraint_name = 'valid_scope_entity'
  ) THEN
    ALTER TABLE rules ADD CONSTRAINT valid_scope_entity
      CHECK (scope_type = 'GLOBAL' OR cardinality(scope_entity_ids) > 0);
    RAISE NOTICE 'Constraint valid_scope_entity criada.';
  ELSE
    RAISE NOTICE 'Constraint valid_scope_entity já existe.';
  END IF;

  -- STEP 6: NOT NULL + default (idempotente no Postgres)
  ALTER TABLE rules ALTER COLUMN scope_entity_ids SET NOT NULL;
  ALTER TABLE rules ALTER COLUMN scope_entity_ids SET DEFAULT '{}';

  RAISE NOTICE 'Migration concluída.';
END $$;

-- STEP 7: Verificação final
SELECT
  scope_type,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE cardinality(scope_entity_ids) > 0) AS with_ids,
  COUNT(*) FILTER (WHERE cardinality(scope_entity_ids) = 0) AS without_ids
FROM rules
GROUP BY scope_type
ORDER BY scope_type;

