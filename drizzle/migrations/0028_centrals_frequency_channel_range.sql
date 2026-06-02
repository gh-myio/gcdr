-- Migration 0028: correct centrals.frequency semantics — it's a RADIO CHANNEL,
-- not a polling cadence. Valid range is an integer 1..255 (preferably > 90),
-- not 1..3600. Replaces the range CHECK added in migration 0027.
--
-- Idempotent: drops the old constraint if present and (re)adds the 1..255 one.
-- Works whether 0027 already ran (old 1..3600 bound) or a fresh DB just ran a
-- corrected 0027.

ALTER TABLE "centrals"
  DROP CONSTRAINT IF EXISTS "centrals_frequency_range_check";

ALTER TABLE "centrals"
  ADD CONSTRAINT "centrals_frequency_range_check"
  CHECK ("frequency" BETWEEN 1 AND 255);
