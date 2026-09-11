-- RFC-0062 Monitor D (rules-monitor) — canonical apply.
-- Persist the tenant-local TIMEZONE the mute's local_day was computed in, so the
-- day-rollover restore can compare `local_day < today(timezone)` UNAMBIGUOUSLY from
-- the ledger alone — without re-reading (or depending on the continued existence of)
-- the source rule. NULL means "derive from the rule / fall back to UTC" for legacy
-- rows written before this column existed. Idempotent (safe to re-run).

ALTER TABLE orchestrator_rule_mutes
  ADD COLUMN IF NOT EXISTS timezone varchar(64);
