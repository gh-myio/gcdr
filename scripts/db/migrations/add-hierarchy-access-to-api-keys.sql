-- =============================================================================
-- add-hierarchy-access-to-api-keys.sql
-- Adds hierarchy_access column to customer_api_keys table
--
-- SELF    → key can only access its own customer data (default)
-- SUBTREE → key can access customer + all descendants (?deep=1)
-- TENANT  → key has no customer restriction (full tenant access)
--
-- Uso:  npm run db:ops scripts/db/migrations/add-hierarchy-access-to-api-keys.sql
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_api_keys' AND column_name = 'hierarchy_access'
  ) THEN
    ALTER TABLE customer_api_keys
      ADD COLUMN hierarchy_access varchar(10) NOT NULL DEFAULT 'SELF'
      CHECK (hierarchy_access IN ('SELF', 'SUBTREE', 'TENANT'));
    RAISE NOTICE 'Column hierarchy_access added to customer_api_keys.';
  ELSE
    RAISE NOTICE 'Column hierarchy_access already exists, skipping.';
  END IF;
END $$;

-- Verificação
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'customer_api_keys' AND column_name = 'hierarchy_access';
