-- =============================================================================
-- RFC-0046 — Customer Consumption Goals · LOCAL TEST SEED
-- =============================================================================
-- Idempotent test data for the four goals tables (apply migration
-- 0047_consumption_goals.sql first). Demonstrates the canonical model:
--   - ENERGY (SUM): a monthly target distributed evenly across the month hours
--     (source_level=MONTH, derived=true), with ONE explicit hour override
--     (source_level=HOUR, derived=false) to show "confirmed vs suggested";
--   - TEMPERATURE (AVERAGE): a monthly setpoint COPIED to each hour;
--   - an append-only history row per change (the level the user acted on).
--
-- Target: the seeded test customer "Dimension".
--   tenant_id   = 11111111-1111-1111-1111-111111111111
--   customer_id = 77777777-7777-7777-7777-777777777777
-- Re-runnable: parent uses ON CONFLICT DO UPDATE, hours upsert, history is
-- cleared for the seeded goals before re-insert so it does not accumulate.
--
-- Run locally:
--   docker exec -i -e PGPASSWORD=postgres gcdr-db-local \
--     psql -U postgres -d db_gcdr -v ON_ERROR_STOP=1 \
--     < scripts/db/seeds/rfc0046-goals-test.sql
-- =============================================================================

DO $$
DECLARE
  v_tenant   uuid := '11111111-1111-1111-1111-111111111111';
  v_customer uuid := '77777777-7777-7777-7777-777777777777';
  v_year     smallint := 2026;

  v_energy_goal uuid;
  v_temp_goal   uuid;

  -- January 2026: 31 days x 24 hours = 744 hours.
  v_jan_hours      int     := 31 * 24;
  v_energy_target  numeric := 100000;  -- kWh for January (SUM domain)
  v_temp_setpoint  numeric := 22;      -- C for January (AVERAGE domain — copied)
BEGIN
  -- ---------------------------------------------------------------------------
  -- ENERGY 2026 (SUM) ----------------------------------------------------------
  -- ---------------------------------------------------------------------------
  INSERT INTO consumption_goals (tenant_id, customer_id, domain, year, unit, version, updated_at)
  VALUES (v_tenant, v_customer, 'ENERGY', v_year, 'kWh', 1, now())
  ON CONFLICT (tenant_id, customer_id, domain, year)
    DO UPDATE SET updated_at = now()
  RETURNING id INTO v_energy_goal;

  DELETE FROM consumption_goal_history WHERE goal_id = v_energy_goal;
  DELETE FROM consumption_goal_hours   WHERE goal_id = v_energy_goal;

  -- January distributed evenly across its 744 hours (source_level=MONTH).
  INSERT INTO consumption_goal_hours (goal_id, month, day, hour, value, source_level, derived)
  SELECT v_energy_goal, 1, d, h, round(v_energy_target / v_jan_hours, 6), 'MONTH', true
  FROM generate_series(1, 31) AS d, generate_series(0, 23) AS h;

  -- One explicit hour override: 2026-01-15 08:00 confirmed by the operator.
  INSERT INTO consumption_goal_hours (goal_id, month, day, hour, value, source_level, derived)
  VALUES (v_energy_goal, 1, 15, 8, 500.000000, 'HOUR', false)
  ON CONFLICT (goal_id, month, day, hour)
    DO UPDATE SET value = EXCLUDED.value, source_level = 'HOUR', derived = false, updated_at = now();

  INSERT INTO consumption_goal_history
    (goal_id, actor, source, action_level, bucket_ref, old_value, new_value, bucket_count, details, distributed, hours_affected, version)
  VALUES
    (v_energy_goal, NULL, 'REPLACE', 'MONTH', '2026-01', NULL, v_energy_target, 1,
       jsonb_build_array(jsonb_build_object('ref', '2026-01', 'value', v_energy_target)), true,  v_jan_hours, 1),
    (v_energy_goal, NULL, 'MERGE',   'HOUR', '2026-01-15T08', NULL, 500, 1,
       jsonb_build_array(jsonb_build_object('ref', '2026-01-15T08', 'value', 500)), false, 1, 1);

  -- ---------------------------------------------------------------------------
  -- TEMPERATURE 2026 (AVERAGE) -------------------------------------------------
  -- ---------------------------------------------------------------------------
  INSERT INTO consumption_goals (tenant_id, customer_id, domain, year, unit, version, updated_at)
  VALUES (v_tenant, v_customer, 'TEMPERATURE', v_year, 'C', 1, now())
  ON CONFLICT (tenant_id, customer_id, domain, year)
    DO UPDATE SET updated_at = now()
  RETURNING id INTO v_temp_goal;

  DELETE FROM consumption_goal_history WHERE goal_id = v_temp_goal;
  DELETE FROM consumption_goal_hours   WHERE goal_id = v_temp_goal;

  -- January setpoint COPIED to each hour (so the weighted average back up = 22).
  INSERT INTO consumption_goal_hours (goal_id, month, day, hour, value, source_level, derived)
  SELECT v_temp_goal, 1, d, h, v_temp_setpoint, 'MONTH', true
  FROM generate_series(1, 31) AS d, generate_series(0, 23) AS h;

  INSERT INTO consumption_goal_history
    (goal_id, actor, source, action_level, bucket_ref, old_value, new_value, bucket_count, details, distributed, hours_affected, version)
  VALUES
    (v_temp_goal, NULL, 'REPLACE', 'MONTH', '2026-01', NULL, v_temp_setpoint, 1,
       jsonb_build_array(jsonb_build_object('ref', '2026-01', 'value', v_temp_setpoint)), true, v_jan_hours, 1);

  RAISE NOTICE 'RFC-0046 test seed applied: ENERGY goal %, TEMPERATURE goal %', v_energy_goal, v_temp_goal;
END $$;

-- Quick verification (SUM rolls Jan up to ~100000 kWh including the +500 override
-- replacing one ~134 hour; TEMPERATURE averages to 22 C):
SELECT g.domain,
       g.year,
       count(h.*)                                   AS hours,
       sum(CASE WHEN h.derived THEN 0 ELSE 1 END)   AS explicit_hours,
       round(sum(h.value::numeric), 2)              AS jan_sum,
       round(avg(h.value::numeric), 4)              AS jan_avg
FROM consumption_goals g
JOIN consumption_goal_hours h ON h.goal_id = g.id
WHERE g.customer_id = '77777777-7777-7777-7777-777777777777'
  AND g.year = 2026
GROUP BY g.domain, g.year
ORDER BY g.domain;
