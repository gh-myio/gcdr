-- Migration 0029: channel-centric device identity (RFC-0008 follow-up).
--
-- A physical board at (central_id, slave_id) can expose multiple channels — e.g.
-- one SW_ILUMINACAO board with 2 lamp outputs + 2 presence inputs. To allow each
-- channel to be modeled as a distinct device, add `channel` + `device_channel_type`
-- and widen the central/slave uniqueness to include them.
--
-- `channel` and `device_channel_type` are OPTIONAL. The new uniqueness must:
--   1. keep allowing unlimited devices with NULL central/slave (non-Modbus)
--        -> partial index: WHERE central_id IS NOT NULL AND slave_id IS NOT NULL
--   2. keep (central, slave) unique when channel/type are absent
--        -> NULLS NOT DISTINCT (PostgreSQL 15+) so (central, slave, NULL, NULL)
--           collides with another (central, slave, NULL, NULL)
--   3. allow the same (central, slave) when channel/type differ
--        -> the two extra columns in the key
--
-- Migration-safe: existing rows already satisfy the old (central, slave)
-- uniqueness, and map to (central, slave, NULL, NULL) under the new index, so
-- no duplicate violation can occur. Idempotent.

ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "channel" smallint;
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "device_channel_type" varchar(100);

-- Channel index sanity bound (NULL allowed; 0..999 mirrors slave_id's range).
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_channel_range_check";
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_channel_range_check"
  CHECK ("channel" IS NULL OR ("channel" >= 0 AND "channel" <= 999));

-- Swap the (tenant, central, slave) uniqueness for the channel-aware one.
DROP INDEX IF EXISTS "devices_tenant_central_slave_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "devices_tenant_central_slave_channel_unique"
  ON "devices" ("tenant_id", "central_id", "slave_id", "channel", "device_channel_type")
  NULLS NOT DISTINCT
  WHERE "central_id" IS NOT NULL AND "slave_id" IS NOT NULL;
