-- Add customers.ingestion_customer_id — the customer's id in the INGESTION system,
-- distinct from external_id (which holds the ThingsBoard customer id / tbId). Backfilled
-- from metadata->>'ingestionId' by scripts/db/ops/backfill-customer-ingestion-customer-id.sql.
-- Idempotent (safe to re-run).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS ingestion_customer_id uuid;

CREATE INDEX IF NOT EXISTS customers_ingestion_customer_id_idx
  ON customers (tenant_id, ingestion_customer_id);
