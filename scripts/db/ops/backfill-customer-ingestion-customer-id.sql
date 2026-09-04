-- Backfill customers.ingestion_customer_id from metadata->>'ingestionId'.
--
-- The ingestion customer id lived only in the customers.metadata jsonb (top-level
-- key "ingestionId", a uuid string; see also "tbId" = ThingsBoard id). Migration 0074
-- adds the dedicated column; this loads it. Idempotent: only fills rows still NULL, and
-- only when the metadata value is a well-formed uuid (a malformed value is skipped, not
-- cast — so the load never fails). Does NOT bump version/updated_at (pure data load).
--
-- Run AFTER migration 0074. Safe to re-run.

\echo 'Before — customers with ingestion_customer_id set:'
SELECT count(*) AS filled FROM customers WHERE ingestion_customer_id IS NOT NULL;

UPDATE customers
SET ingestion_customer_id = (metadata->>'ingestionId')::uuid
WHERE ingestion_customer_id IS NULL
  AND metadata ? 'ingestionId'
  AND (metadata->>'ingestionId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

\echo 'After — customers with ingestion_customer_id set:'
SELECT count(*) AS filled FROM customers WHERE ingestion_customer_id IS NOT NULL;

\echo 'Skipped — have metadata.ingestionId but still NULL (malformed / non-uuid):'
SELECT id, name, metadata->>'ingestionId' AS raw
FROM customers
WHERE ingestion_customer_id IS NULL AND metadata ? 'ingestionId';
