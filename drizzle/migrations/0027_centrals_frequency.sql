-- Migration 0027: add frequency column to centrals (gateways)
--
-- Additive only — one NOT NULL column with a server default, so existing rows
-- are backfilled to 60 automatically (PG fast-default, no table rewrite).
--
-- Semantics mirror devices.frequency (RFC-0008): polling/read cadence in
-- SECONDS, range 1..3600. Every gateway has a frequency, hence NOT NULL.

ALTER TABLE "centrals"
  ADD COLUMN IF NOT EXISTS "frequency" integer NOT NULL DEFAULT 60;

-- Guard the valid range at the DB level (matches the Zod min(1).max(3600)).
ALTER TABLE "centrals"
  ADD CONSTRAINT "centrals_frequency_range_check"
  CHECK ("frequency" BETWEEN 1 AND 3600);
