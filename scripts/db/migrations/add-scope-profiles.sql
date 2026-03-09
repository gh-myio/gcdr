-- =============================================================================
-- add-scope-profiles.sql
-- Adiciona coluna scope_profiles (text[]) na tabela rules
-- Idempotente: verifica existência antes de alterar
--
-- Uso:  npm run db:ops scripts/db/migrations/add-scope-profiles.sql
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rules' AND column_name = 'scope_profiles'
  ) THEN
    ALTER TABLE rules ADD COLUMN scope_profiles text[];
    RAISE NOTICE 'Column scope_profiles added to rules.';
  ELSE
    RAISE NOTICE 'Column scope_profiles already exists, skipping.';
  END IF;
END $$;

-- Verificação
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'rules' AND column_name = 'scope_profiles';
