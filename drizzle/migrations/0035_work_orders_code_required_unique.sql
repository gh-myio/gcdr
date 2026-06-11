-- Migration 0035: work_orders.code mandatory + unique per tenant
--
-- `code` becomes NOT NULL and unique among non-deleted WOs of a tenant.
-- Generated codes follow OS-<Mercosul plate> (LLLNLNN) excluding the
-- lookalike characters I, O, 1 and 0. Legacy NULL/blank codes are
-- backfilled with generated codes; duplicated legacy codes get an
-- id-derived suffix so the unique index can be created.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction and
-- rejects explicit transaction-control statements.

-- 1) Backfill NULL/blank codes with generated OS-XXXNXNN codes.
DO $$
DECLARE
  r RECORD;
  letters CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; -- 24 letters, no I/O
  digits  CONSTANT text := '23456789';                 -- 8 digits, no 0/1
  candidate text;
BEGIN
  FOR r IN SELECT id, tenant_id FROM work_orders WHERE code IS NULL OR btrim(code) = '' LOOP
    LOOP
      candidate := 'OS-'
        || substr(letters, 1 + floor(random() * 24)::int, 1)
        || substr(letters, 1 + floor(random() * 24)::int, 1)
        || substr(letters, 1 + floor(random() * 24)::int, 1)
        || substr(digits,  1 + floor(random() * 8)::int, 1)
        || substr(letters, 1 + floor(random() * 24)::int, 1)
        || substr(digits,  1 + floor(random() * 8)::int, 1)
        || substr(digits,  1 + floor(random() * 8)::int, 1);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM work_orders WHERE tenant_id = r.tenant_id AND code = candidate
      );
    END LOOP;
    UPDATE work_orders SET code = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- 2) De-duplicate legacy codes among non-deleted rows: the oldest keeps the
--    original code, later ones get an id-derived suffix (unique per row).
UPDATE work_orders w
SET code = w.code || '-' || upper(substr(replace(w.id::text, '-', ''), 1, 4))
WHERE w.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM work_orders o
    WHERE o.tenant_id = w.tenant_id
      AND o.code = w.code
      AND o.deleted_at IS NULL
      AND o.id <> w.id
      AND (o.created_at < w.created_at OR (o.created_at = w.created_at AND o.id < w.id))
  );

-- 3) Enforce.
ALTER TABLE work_orders ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_tenant_code_unique
  ON work_orders (tenant_id, code)
  WHERE deleted_at IS NULL;
