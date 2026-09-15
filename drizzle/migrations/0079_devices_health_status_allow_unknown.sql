-- Prod schema-drift fix: the devices.health_status CHECK constraint in
-- production allowed only ('HEALTHY','DEGRADED','CRITICAL') and OMITTED
-- 'UNKNOWN'. The orchestrator-devices worker legitimately writes
-- health_status='UNKNOWN' (ladder.ts, e.g. the SCAN_FAILED path), so any batch
-- UPDATE that set a device to 'UNKNOWN' violated devices_health_status_check and
-- the whole batch rolled back — device status stopped updating and prod logs
-- filled with "violates check constraint devices_health_status_check".
--
-- Realign the allowed set to the worker's Health type
-- {HEALTHY,DEGRADED,CRITICAL,UNKNOWN}. Additive (only widens the allowlist);
-- every existing row — including the ~1400 NULLs, which pass CHECK semantics —
-- stays valid, so validation is an instant scan with no rewrite.
--
-- Idempotent + drift-tolerant: acts ONLY if the check constraint exists. In
-- production health_status is a varchar with this CHECK; a from-scratch DB
-- follows migration 0070 where health_status is an ENUM and NO such check
-- exists — there this block is a no-op (the enum already permits the four
-- values). This migration does NOT attempt the larger varchar→enum
-- reconciliation; that is a separate, backfill-first change.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devices_health_status_check'
  ) THEN
    ALTER TABLE devices DROP CONSTRAINT devices_health_status_check;
    ALTER TABLE devices ADD CONSTRAINT devices_health_status_check
      CHECK ((health_status)::text = ANY (ARRAY['HEALTHY','DEGRADED','CRITICAL','UNKNOWN']));
  END IF;
END $$;
