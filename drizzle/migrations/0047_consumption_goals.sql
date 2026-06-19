-- Migration NNNN: RFC-0046 — Customer Consumption Goals
--
-- NOTE: the real migration number (NNNN) is assigned at integration time —
-- rename this file (and this header) to the next free slot under
-- drizzle/migrations/ when wiring it into the custom runner. As of authoring,
-- the highest applied is 0046_devices_label_widen_255.sql.
--
-- Creates the four tables for per-customer consumption goals (ENERGY | WATER |
-- TEMPERATURE), stored at the canonical hourly grain with the optimistic
-- `version` on the parent, plus an append-only history. Seeds the fixed
-- per-domain aggregation config for every existing tenant.
--
-- Companion: docs/RFC-0046-Customer-Consumption-Goals.md ·
--            docs/RFC-0046-Goals-schema.md (Drizzle snippet for schema.ts)
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

-- =============================================================================
-- 1) consumption_goals — parent; holds the optimistic version.
--    One per (tenant, customer, domain, year).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "consumption_goals" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   uuid        NOT NULL,
  "customer_id" uuid        NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "domain"      text        NOT NULL,            -- ENERGY | WATER | TEMPERATURE
  "year"        smallint    NOT NULL,
  "unit"        text        NOT NULL,            -- kWh | m3 | C (from domain config)
  "version"     integer     NOT NULL DEFAULT 1,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "created_by"  uuid,
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_by"  uuid,
  CONSTRAINT "consumption_goals_uq"
    UNIQUE ("tenant_id", "customer_id", "domain", "year"),
  CONSTRAINT "consumption_goals_domain_check"
    CHECK ("domain" IN ('ENERGY','WATER','TEMPERATURE'))
);

CREATE INDEX IF NOT EXISTS "consumption_goals_customer_idx"
  ON "consumption_goals" ("tenant_id", "customer_id");

-- =============================================================================
-- 2) consumption_goal_hours — the canonical hourly grain.
--    Up to 8,760 rows per (customer, domain, year); coarser views derived on read.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "consumption_goal_hours" (
  "goal_id"      uuid        NOT NULL REFERENCES "consumption_goals"("id") ON DELETE CASCADE,
  "month"        smallint    NOT NULL,           -- 1..12
  "day"          smallint    NOT NULL,           -- 1..31 (valid for the month/year)
  "hour"         smallint    NOT NULL,           -- 0..23
  "value"        numeric     NOT NULL,
  "source_level" text        NOT NULL,           -- YEAR | MONTH | DAY | HOUR (level the user set)
  "derived"      boolean     NOT NULL,           -- true = system-distributed
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_by"   uuid,
  CONSTRAINT "consumption_goal_hours_uq"
    UNIQUE ("goal_id", "month", "day", "hour"),
  CONSTRAINT "consumption_goal_hours_month_check"
    CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "consumption_goal_hours_day_check"
    CHECK ("day" BETWEEN 1 AND 31),
  CONSTRAINT "consumption_goal_hours_hour_check"
    CHECK ("hour" BETWEEN 0 AND 23),
  CONSTRAINT "consumption_goal_hours_source_level_check"
    CHECK ("source_level" IN ('YEAR','MONTH','DAY','HOUR'))
);

-- =============================================================================
-- 3) consumption_goal_domains — fixed aggregation config per (tenant, domain).
--    Operator-immutable; tenant override is future.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "consumption_goal_domains" (
  "tenant_id"          uuid NOT NULL,
  "domain"             text NOT NULL,            -- ENERGY | WATER | TEMPERATURE
  "aggregation_method" text NOT NULL,            -- SUM | AVERAGE
  "unit"               text NOT NULL,            -- kWh | m3 | C
  PRIMARY KEY ("tenant_id", "domain"),
  CONSTRAINT "consumption_goal_domains_agg_method_check"
    CHECK ("aggregation_method" IN ('SUM','AVERAGE')),
  CONSTRAINT "consumption_goal_domains_domain_check"
    CHECK ("domain" IN ('ENERGY','WATER','TEMPERATURE'))
);

-- =============================================================================
-- 4) consumption_goal_history — append-only audit (DEC-4).
--    Records the level the user acted on + how it distributed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "consumption_goal_history" (
  "id"             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "goal_id"        uuid        NOT NULL,
  "actor"          uuid,                          -- who changed it
  "action_level"   text        NOT NULL,          -- YEAR | MONTH | DAY | HOUR (what the user touched)
  "bucket_ref"     text        NOT NULL,          -- "2026" | "2026-03" | "2026-03-15" | "2026-03-15T08"
  "old_value"      numeric,                        -- at the input level (NULL on create)
  "new_value"      numeric,                        -- at the input level (NULL on delete)
  "distributed"    boolean     NOT NULL,           -- true = system spread to hours
  "hours_affected" integer     NOT NULL,           -- count of hour rows written by this change
  "version"        integer     NOT NULL,           -- the version this change produced
  "changed_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "consumption_goal_history_action_level_check"
    CHECK ("action_level" IN ('YEAR','MONTH','DAY','HOUR'))
);

CREATE INDEX IF NOT EXISTS "consumption_goal_history_idx"
  ON "consumption_goal_history" ("goal_id", "changed_at" DESC);

-- =============================================================================
-- 5) Seed consumption_goal_domains for every existing tenant.
--    ENERGY -> SUM/kWh, WATER -> SUM/m3, TEMPERATURE -> AVERAGE/C.
--    Tenants are enumerated from the customers table (the only authoritative
--    list of live tenant_ids). Idempotent via ON CONFLICT; new tenants created
--    after this migration are seeded by the service on first goals access.
-- =============================================================================

INSERT INTO "consumption_goal_domains" ("tenant_id", "domain", "aggregation_method", "unit")
SELECT t."tenant_id", d."domain", d."aggregation_method", d."unit"
FROM (SELECT DISTINCT "tenant_id" FROM "customers") AS t
CROSS JOIN (
  VALUES
    ('ENERGY',      'SUM',     'kWh'),
    ('WATER',       'SUM',     'm3'),
    ('TEMPERATURE', 'AVERAGE', 'C')
) AS d("domain", "aggregation_method", "unit")
ON CONFLICT ("tenant_id", "domain") DO NOTHING;
