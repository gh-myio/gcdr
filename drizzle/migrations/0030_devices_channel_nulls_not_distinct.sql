-- Migration 0030: converge the devices channel-uniqueness to its intended shape.
--
-- Why: environments bootstrapped with `drizzle-kit push` (local dev AND the
-- Dokploy cloud DB) created `devices_tenant_central_slave_channel_unique`
-- WITHOUT `NULLS NOT DISTINCT` (drizzle cannot express it) and WITHOUT the
-- `devices_channel_range_check` CHECK. Migration 0029 only reconciles a
-- migration-built env (it drops the OLD index name and uses IF NOT EXISTS), so
-- it is a no-op on push-built envs. This migration converges ALL environments.
--
-- Idempotent and safe: existing rows already satisfy (central, slave)
-- uniqueness, so recreating the index cannot raise a duplicate violation.
--
-- NOTE for large `devices` tables: the DROP + CREATE UNIQUE INDEX below takes a
-- brief write lock. If that is a concern in production, run the CREATE as
-- `CREATE UNIQUE INDEX CONCURRENTLY` instead — but CONCURRENTLY cannot run
-- inside a transaction, so apply it with psql directly (not via the tx-wrapped
-- runner) in that case.

-- Recreate the partial unique index WITH NULLS NOT DISTINCT (PostgreSQL 15+).
DROP INDEX IF EXISTS "devices_tenant_central_slave_channel_unique";
CREATE UNIQUE INDEX "devices_tenant_central_slave_channel_unique"
  ON "devices" ("tenant_id", "central_id", "slave_id", "channel", "device_channel_type")
  NULLS NOT DISTINCT
  WHERE "central_id" IS NOT NULL AND "slave_id" IS NOT NULL;

-- Ensure the channel range CHECK exists (re-add idempotently).
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_channel_range_check";
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_channel_range_check"
  CHECK ("channel" IS NULL OR ("channel" >= 0 AND "channel" <= 999));
