-- Migration 0062: RFC-0054 (APPROVED rev. 3) — Phase 1: hourly customer tariffs.
--
-- Phase 1 is ADDITIVE and, by the RFC's hard gate (DEC-12 / AC-P1.4), MUST NOT
-- reference `consumption_goals` in any way. The measure column + the goal
-- uniqueness recreation live ONLY in migration 0063 (Phase 3).
--
-- Model (DEC-2/DEC-3): a tariff is (customer, domain, category, year)
-- distributed to an HOURLY canonical grain — structurally a sibling of a goal.
-- category ('COMMON_AREA' | 'SPECIFIC') is an explicit device attribute
-- (DEC-2, never inferred). The hourly grain makes overlap impossible by a
-- plain UNIQUE (tariff_id, month, day, hour) — NO daterange / EXCLUDE /
-- btree_gist. Calendar is nominal civil hours in `timezone` (DEC-8), leap years
-- materialize 8 784 rows.
--
-- Companion: docs/rfcs/RFC-0054-Monetary-Goals-and-Customer-Tariffs.md
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

-- 0) DEC-2 — explicit tariff category on the device (both-or-nothing not needed;
--    a single nullable enum). NEVER inferred; a NULL device is excluded from the
--    money overlay and reported as uncategorized.
ALTER TABLE "devices"
  ADD COLUMN IF NOT EXISTS "tariff_category" text;

ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_tariff_category_check";
ALTER TABLE "devices" ADD CONSTRAINT "devices_tariff_category_check"
  CHECK ("tariff_category" IS NULL OR "tariff_category" IN ('COMMON_AREA', 'SPECIFIC'));

-- 1) DEC-3 — tariff header, one per (tenant, customer, domain, category, year).
CREATE TABLE IF NOT EXISTS "customer_tariffs" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    uuid NOT NULL,
  "customer_id"  uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "domain"       text NOT NULL,                                 -- ENERGY | WATER (priced SUM domains)
  "category"     text NOT NULL,                                 -- COMMON_AREA | SPECIFIC
  "year"         smallint NOT NULL,
  "unit"         text NOT NULL,                                 -- kWh | m3 (from domain)
  "currency"     text NOT NULL DEFAULT 'BRL',
  "tariff_model" text NOT NULL DEFAULT 'FLAT',                  -- v1 = FLAT; evolution axis (tiered later)
  "timezone"     text NOT NULL DEFAULT 'America/Sao_Paulo',     -- nominal civil-hour calendar (DEC-8)
  "version"      integer NOT NULL DEFAULT 1,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "created_by"   uuid,
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_by"   uuid,
  CONSTRAINT "customer_tariffs_domain_check"   CHECK ("domain" IN ('ENERGY', 'WATER')),
  CONSTRAINT "customer_tariffs_category_check" CHECK ("category" IN ('COMMON_AREA', 'SPECIFIC')),
  CONSTRAINT "customer_tariffs_unit_check"     CHECK ("unit" IN ('kWh', 'm3')),
  CONSTRAINT "customer_tariffs_currency_check" CHECK ("currency" = 'BRL'),
  CONSTRAINT "customer_tariffs_model_check"    CHECK ("tariff_model" IN ('FLAT')),
  -- unit is derived from domain (RFC-0054): enforce the pairing at the DB, not
  -- only in the service (ENERGY→kWh, WATER→m3).
  CONSTRAINT "customer_tariffs_domain_unit_check" CHECK (
    ("domain" = 'ENERGY' AND "unit" = 'kWh') OR
    ("domain" = 'WATER'  AND "unit" = 'm3')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_tariffs_uq"
  ON "customer_tariffs" ("tenant_id", "customer_id", "domain", "category", "year");
CREATE INDEX IF NOT EXISTS "customer_tariffs_customer_idx"
  ON "customer_tariffs" ("tenant_id", "customer_id");

-- 2) DEC-3 — canonical hourly grain. One row per (tariff, month, day, hour).
-- The plain UNIQUE below is the whole no-overlap story (DEC-8): two prices for
-- the same hour are impossible; a "band" is a contiguous set of hour rows.
CREATE TABLE IF NOT EXISTS "customer_tariff_hours" (
  "tariff_id"    uuid NOT NULL REFERENCES "customer_tariffs"("id") ON DELETE CASCADE,
  "month"        smallint NOT NULL,                             -- 1..12
  "day"          smallint NOT NULL,                             -- 1..31 (valid for month/year; 29 Feb in leap years)
  "hour"         smallint NOT NULL,                             -- 0..23 (nominal civil hour)
  "price"        numeric(14,6) NOT NULL,                        -- R$ per unit
  "source_level" text NOT NULL,                                 -- YEAR | MONTH | DAY | HOUR (level the operator set)
  "derived"      boolean NOT NULL,                              -- true = system-distributed
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_by"   uuid,
  CONSTRAINT "customer_tariff_hours_month_check" CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "customer_tariff_hours_day_check"   CHECK ("day"   BETWEEN 1 AND 31),
  CONSTRAINT "customer_tariff_hours_hour_check"  CHECK ("hour"  BETWEEN 0 AND 23),
  CONSTRAINT "customer_tariff_hours_price_check" CHECK ("price" > 0),
  CONSTRAINT "customer_tariff_hours_source_level_check"
    CHECK ("source_level" IN ('YEAR', 'MONTH', 'DAY', 'HOUR'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_tariff_hours_uq"
  ON "customer_tariff_hours" ("tariff_id", "month", "day", "hour");

-- 3) DEC-10 — append-only audit, stable key survives a header delete (mirrors
-- consumption_goal_history's post-0060 identity design).
-- Stable-key columns are NOT NULL by design: this table is greenfield (no
-- pre-existing orphans like consumption_goal_history had pre-0060), and its
-- whole purpose is to keep the audit trail reachable by identity after the
-- header is deleted — a null identity would defeat that.
CREATE TABLE IF NOT EXISTS "customer_tariff_history" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tariff_id"     uuid NOT NULL,                                -- no FK: audit outlives the header
  "tenant_id"     uuid NOT NULL,
  "customer_id"   uuid NOT NULL,
  "domain"        text NOT NULL,
  "category"      text NOT NULL,
  "year"          integer NOT NULL,
  "actor"         uuid,
  "source"        text NOT NULL DEFAULT 'EDIT',                 -- IMPORT | REPLACE | MERGE | DELETE | EDIT
  "action_level"  text NOT NULL,                                -- YEAR | MONTH | DAY | HOUR
  "bucket_ref"    text NOT NULL,                                -- "2026" | "2026-07" | "2026-07-01" | "2026-07-01T15"
  "old_price"     numeric(14,6),
  "new_price"     numeric(14,6),
  "bucket_count"  integer NOT NULL DEFAULT 1,
  "hours_affected" integer NOT NULL,
  "version"       integer NOT NULL,
  "changed_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "customer_tariff_history_source_check"
    CHECK ("source" IN ('IMPORT', 'REPLACE', 'MERGE', 'DELETE', 'EDIT')),
  CONSTRAINT "customer_tariff_history_action_level_check"
    CHECK ("action_level" IN ('YEAR', 'MONTH', 'DAY', 'HOUR'))
);

CREATE INDEX IF NOT EXISTS "customer_tariff_history_key_idx"
  ON "customer_tariff_history" ("tenant_id", "customer_id", "domain", "category", "year", "changed_at" DESC);

-- 4) DEC-9 — RBAC policy for tariff management (idempotent seed, default tenant).
-- Prod runs scripts/db/ops/add-tariff-management-policy.sql alongside the deploy.
DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        gen_random_uuid(),
        v_tenant_id,
        'policy:tariff-management',
        'Customer Tariff Management',
        'Read and edit customer hourly tariffs (RFC-0054): R$/kWh and R$/m3 per category',
        '["tariffs.tariff.read", "tariffs.tariff.update"]',
        '[]',
        'medium',
        false,
        1
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

    UPDATE roles
    SET policies = policies || '["policy:tariff-management"]'::jsonb,
        version = version + 1
    WHERE tenant_id = v_tenant_id
      AND key IN ('role:customer-admin', 'role:energy-analyst')
      AND NOT policies @> '["policy:tariff-management"]'::jsonb;
END $$;
