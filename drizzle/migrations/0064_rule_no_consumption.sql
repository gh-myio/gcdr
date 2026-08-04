-- Migration 0064: RFC-0055 — NO_CONSUMPTION rule type (data-absence detection)
--
-- Adds the NO_CONSUMPTION value to the rule_type enum and the
-- no_consumption_config JSONB column on `rules`.
--
-- The CHECK constraint that references the new enum value lives in migration
-- 0065 on purpose: Postgres forbids using a freshly-added enum value in the same
-- transaction that added it, and the custom runner wraps each file in its own tx.
--
-- Additive and safe on an existing database.
--
-- NOTE (numbering): prod is baselined through 0063. This number may collide with
-- other in-flight branches (e.g. PR #20 central-wifi) — reconcile the sequence at
-- merge time; the runner keys by filename + checksum, so it is not fatal.

ALTER TYPE "public"."rule_type" ADD VALUE IF NOT EXISTS 'NO_CONSUMPTION';

ALTER TABLE "rules" ADD COLUMN IF NOT EXISTS "no_consumption_config" jsonb;
