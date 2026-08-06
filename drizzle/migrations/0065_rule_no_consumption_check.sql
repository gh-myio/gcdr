-- Migration 0065: RFC-0055 — NO_CONSUMPTION config CHECK constraint
--
-- Separate from 0064 because Postgres cannot use the 'NO_CONSUMPTION' enum value
-- in the same transaction that added it. Mirrors valid_alarm_config /
-- valid_sla_config etc.: a NO_CONSUMPTION rule must carry its config.

ALTER TABLE "rules" DROP CONSTRAINT IF EXISTS "valid_no_consumption_config";
ALTER TABLE "rules" ADD CONSTRAINT "valid_no_consumption_config"
  CHECK ("type" != 'NO_CONSUMPTION' OR "no_consumption_config" IS NOT NULL);
