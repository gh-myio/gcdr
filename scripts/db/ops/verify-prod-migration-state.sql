-- =============================================================================
-- VERIFY — detect the REAL last-applied migration in this database.
-- =============================================================================
-- Read-only (only SELECTs). Safe to run anywhere: psql, the Dokploy DB console,
-- or any SQL client pointed at the target DB.
--
-- Why a schema probe (not just schema_migrations): the runner's tracking table
-- has drifted before (0031–0036 were once applied via raw SQL without being
-- recorded). So Section 2 probes the ACTUAL schema for a marker object each
-- migration creates — that is the ground truth. The last row showing YES (in a
-- contiguous run) is your real high-water mark.
--
-- Assumes the WO event model (0031) is present — i.e. table
-- work_orders_event_types exists. True for any prod at >= 0036. If this errors
-- on that table, the DB is older than 0031; tell me and I'll adapt.
-- =============================================================================


-- 1) What the runner RECORDS (may be stale — compare against Section 2) -------
SELECT count(*)      AS recorded_count,
       max(filename) AS latest_recorded
FROM schema_migrations;

-- Full recorded list, newest first:
SELECT filename, applied_at, applied_by
FROM schema_migrations
ORDER BY filename DESC;


-- 2) What the SCHEMA actually shows (ground truth) ---------------------------
WITH probe AS (
  SELECT '0027_centrals_frequency'                AS migration, EXISTS(SELECT 1 FROM information_schema.columns      WHERE table_name='centrals'                    AND column_name='frequency')                          AS applied
  UNION ALL SELECT '0029_devices_channel',                       EXISTS(SELECT 1 FROM information_schema.columns      WHERE table_name='devices'                     AND column_name='channel')
  UNION ALL SELECT '0031_work_orders_event_model',               EXISTS(SELECT 1 FROM information_schema.tables       WHERE table_name='work_orders')
  UNION ALL SELECT '0032_produto_criado_to_instalado',           EXISTS(SELECT 1 FROM work_orders_event_types        WHERE code='PRODUTO_INSTALADO')
  UNION ALL SELECT '0033_file_assets_owner_type',                EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='file_assets_owner_type_check')
  UNION ALL SELECT '0034_event_type_ambiente_verificado',        EXISTS(SELECT 1 FROM work_orders_event_types        WHERE code='AMBIENTE_VERIFICADO')
  UNION ALL SELECT '0035_work_orders_code_required_unique',      EXISTS(SELECT 1 FROM pg_indexes                     WHERE indexname='work_orders_tenant_code_unique')
  UNION ALL SELECT '0036_customer_api_keys_recoverable',         EXISTS(SELECT 1 FROM information_schema.columns      WHERE table_name='customer_api_keys'           AND column_name='key_plain')
  UNION ALL SELECT '0037_event_type_wo_desatribuida',            EXISTS(SELECT 1 FROM work_orders_event_types        WHERE code='WO_DESATRIBUIDA')
  UNION ALL SELECT '0038_event_types_validators',                EXISTS(SELECT 1 FROM work_orders_event_types        WHERE code='WO_VALIDADOR_ATRIBUIDO')
  UNION ALL SELECT '0039_event_type_ambiente_associado',         EXISTS(SELECT 1 FROM work_orders_event_types        WHERE code='AMBIENTE_ASSOCIADO')
  UNION ALL SELECT '0040_work_orders_lifecycle_rules',           EXISTS(SELECT 1 FROM information_schema.tables       WHERE table_name='work_orders_lifecycle_rules')
  UNION ALL SELECT '0041_lifecycle_rules_is_terminal',           EXISTS(SELECT 1 FROM information_schema.columns      WHERE table_name='work_orders_lifecycle_rules' AND column_name='is_terminal')
  UNION ALL SELECT '0042_assistant_conversations',               EXISTS(SELECT 1 FROM information_schema.tables       WHERE table_name='assistant_conversations')
  UNION ALL SELECT '0043_chamados_work_order_type',              EXISTS(SELECT 1 FROM information_schema.columns      WHERE table_name='work_orders'                 AND column_name='ticket_id')
  UNION ALL SELECT '0044_chamado_import_event',                  EXISTS(SELECT 1 FROM work_orders_event_types        WHERE code='CHAMADO_IMPORTADO')
  UNION ALL SELECT '0046_devices_label_widen_255',               EXISTS(SELECT 1 FROM information_schema.columns      WHERE table_name='devices'                     AND column_name='label' AND character_maximum_length=255)
  UNION ALL SELECT '0047_consumption_goals',                     EXISTS(SELECT 1 FROM information_schema.tables       WHERE table_name='consumption_goals')
  UNION ALL SELECT '0048_consumption_goals_history_ops',         EXISTS(SELECT 1 FROM information_schema.columns      WHERE table_name='consumption_goal_history'    AND column_name='bucket_count')
  -- 0049/0050 (entities) intentionally NOT probed — they belong to the unmerged
  -- PR and must not be in prod yet.
)
SELECT migration,
       CASE WHEN applied THEN 'YES' ELSE '--  MISSING' END AS in_schema
FROM probe
ORDER BY migration;

-- Headline: the highest migration whose marker is present in the schema.
WITH probe AS (
  SELECT '0027' AS n, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='centrals' AND column_name='frequency') AS applied
  UNION ALL SELECT '0029', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='channel')
  UNION ALL SELECT '0031', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='work_orders')
  UNION ALL SELECT '0032', EXISTS(SELECT 1 FROM work_orders_event_types WHERE code='PRODUTO_INSTALADO')
  UNION ALL SELECT '0033', EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='file_assets_owner_type_check')
  UNION ALL SELECT '0034', EXISTS(SELECT 1 FROM work_orders_event_types WHERE code='AMBIENTE_VERIFICADO')
  UNION ALL SELECT '0035', EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='work_orders_tenant_code_unique')
  UNION ALL SELECT '0036', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='customer_api_keys' AND column_name='key_plain')
  UNION ALL SELECT '0037', EXISTS(SELECT 1 FROM work_orders_event_types WHERE code='WO_DESATRIBUIDA')
  UNION ALL SELECT '0038', EXISTS(SELECT 1 FROM work_orders_event_types WHERE code='WO_VALIDADOR_ATRIBUIDO')
  UNION ALL SELECT '0039', EXISTS(SELECT 1 FROM work_orders_event_types WHERE code='AMBIENTE_ASSOCIADO')
  UNION ALL SELECT '0040', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='work_orders_lifecycle_rules')
  UNION ALL SELECT '0041', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='work_orders_lifecycle_rules' AND column_name='is_terminal')
  UNION ALL SELECT '0042', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='assistant_conversations')
  UNION ALL SELECT '0043', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='work_orders' AND column_name='ticket_id')
  UNION ALL SELECT '0044', EXISTS(SELECT 1 FROM work_orders_event_types WHERE code='CHAMADO_IMPORTADO')
  UNION ALL SELECT '0046', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='devices' AND column_name='label' AND character_maximum_length=255)
  UNION ALL SELECT '0047', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='consumption_goals')
  UNION ALL SELECT '0048', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='consumption_goal_history' AND column_name='bucket_count')
)
SELECT max(n) FILTER (WHERE applied)            AS highest_marker_present,
       count(*) FILTER (WHERE applied)          AS markers_present,
       count(*) FILTER (WHERE NOT applied)      AS markers_missing
FROM probe;
