-- Migration 0061: RFC-0046 Addendum A (APPROVED rev. 2) — device-granular goals.
--
-- DEC-11: explicit meter purpose on the device registry — meter_role
-- (ENTRY|SUBMETER) + meter_domain (ENERGY|WATER), both-or-neither. ENTRY
-- participation in the residual allocation is NEVER inferred.
--
-- DEC-7/8: device as an optional dimension of the hourly canonical grain.
-- device_id stays a real nullable FK (ON DELETE RESTRICT — goal hours are
-- operator-authored; deleting a meter must not silently destroy them);
-- device_key is a STORED generated column because Drizzle's onConflictDoUpdate
-- cannot target an expression index. device_allocation records whether the
-- operator stated the device's value (EXPLICIT) or the system allocated it
-- from the group total (RESIDUAL).
--
-- Existing rows keep device_id NULL (CUSTOMER granularity) — fully backward
-- compatible, no backfill.
--
-- Companion: docs/rfcs/RFC-0046-Addendum-A-Device-Granular-Goals.md
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

-- 0) DEC-11 — meter purpose on devices
ALTER TABLE "devices"
  ADD COLUMN IF NOT EXISTS "meter_role"   text,
  ADD COLUMN IF NOT EXISTS "meter_domain" text;

ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_meter_role_check";
ALTER TABLE "devices" ADD CONSTRAINT "devices_meter_role_check"
  CHECK ("meter_role" IS NULL OR "meter_role" IN ('ENTRY', 'SUBMETER'));

ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_meter_domain_check";
ALTER TABLE "devices" ADD CONSTRAINT "devices_meter_domain_check"
  CHECK ("meter_domain" IS NULL OR "meter_domain" IN ('ENERGY', 'WATER'));

ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_meter_pair_check";
ALTER TABLE "devices" ADD CONSTRAINT "devices_meter_pair_check"
  CHECK (("meter_role" IS NULL) = ("meter_domain" IS NULL));

-- 1..3) DEC-7 — device dimension on the hour grain
ALTER TABLE "consumption_goal_hours"
  ADD COLUMN IF NOT EXISTS "device_id" uuid REFERENCES "devices"("id") ON DELETE RESTRICT;

ALTER TABLE "consumption_goal_hours"
  ADD COLUMN IF NOT EXISTS "device_key" uuid GENERATED ALWAYS AS
    (COALESCE("device_id", '00000000-0000-0000-0000-000000000000'::uuid)) STORED;

ALTER TABLE "consumption_goal_hours"
  ADD COLUMN IF NOT EXISTS "device_allocation" text NOT NULL DEFAULT 'EXPLICIT';

ALTER TABLE "consumption_goal_hours" DROP CONSTRAINT IF EXISTS "consumption_goal_hours_allocation_check";
ALTER TABLE "consumption_goal_hours" ADD CONSTRAINT "consumption_goal_hours_allocation_check"
  CHECK ("device_allocation" IN ('EXPLICIT', 'RESIDUAL'));

-- New uniqueness (device is a coordinate like `hour`), then drop the old one.
CREATE UNIQUE INDEX IF NOT EXISTS "consumption_goal_hours_device_uq"
  ON "consumption_goal_hours" ("goal_id", "device_key", "month", "day", "hour");

-- 0047 created this uniqueness as a table CONSTRAINT (whose backing index
-- cannot be dropped directly — 2BP01); other environments may hold it as a
-- plain index. Drop whichever form exists.
ALTER TABLE "consumption_goal_hours" DROP CONSTRAINT IF EXISTS "consumption_goal_hours_uq";
DROP INDEX IF EXISTS "consumption_goal_hours_uq";

-- 4) DEC-8 — explicit granularity on the header
ALTER TABLE "consumption_goals"
  ADD COLUMN IF NOT EXISTS "granularity" text NOT NULL DEFAULT 'CUSTOMER';

ALTER TABLE "consumption_goals" DROP CONSTRAINT IF EXISTS "consumption_goals_granularity_check";
ALTER TABLE "consumption_goals" ADD CONSTRAINT "consumption_goals_granularity_check"
  CHECK ("granularity" IN ('CUSTOMER', 'DEVICE'));

-- 5) History: device coordinate + the DEC-12 REBALANCE source
ALTER TABLE "consumption_goal_history"
  ADD COLUMN IF NOT EXISTS "device_id" uuid;

ALTER TABLE "consumption_goal_history" DROP CONSTRAINT IF EXISTS "consumption_goal_history_source_check";
ALTER TABLE "consumption_goal_history" ADD CONSTRAINT "consumption_goal_history_source_check"
  CHECK ("source" IN ('IMPORT','REPLACE','MERGE','DELETE','EDIT','MARGIN','REBALANCE'));
