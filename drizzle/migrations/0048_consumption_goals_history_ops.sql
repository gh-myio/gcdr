-- =============================================================================
-- RFC-0046 — Customer Consumption Goals · OPERATION-LEVEL AUDIT (history)
-- =============================================================================
-- Evolves consumption_goal_history from one row PER BUCKET to one row PER
-- OPERATION (one mutation = one version = one audit entry), so the UI timeline
-- can read clean, human entries like:
--   "Importação de planilha — 120 registros"
--   "Edição de metas — 12/05/2026, horários 08..18"
-- and a single large import no longer floods the ≤100-row history window.
--
-- Additive + idempotent:
--   - source        : the operation that produced this version.
--   - bucket_count  : how many operator buckets the operation carried.
--   - details       : compact [{ ref, value }] sample (capped by the service)
--                     used to render the per-entry breakdown.
--
-- Apply locally:
--   docker exec -i -e PGPASSWORD=postgres gcdr-db-local \
--     psql -U postgres -d db_gcdr -v ON_ERROR_STOP=1 \
--     < drizzle/migrations/0048_consumption_goals_history_ops.sql
-- =============================================================================

ALTER TABLE consumption_goal_history
  ADD COLUMN IF NOT EXISTS source       text    NOT NULL DEFAULT 'EDIT',
  ADD COLUMN IF NOT EXISTS bucket_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS details      jsonb   NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE consumption_goal_history
  DROP CONSTRAINT IF EXISTS consumption_goal_history_source_check;

ALTER TABLE consumption_goal_history
  ADD CONSTRAINT consumption_goal_history_source_check
  CHECK (source IN ('IMPORT','REPLACE','MERGE','DELETE','EDIT'));
