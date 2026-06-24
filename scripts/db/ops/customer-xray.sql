-- =============================================================================
-- CUSTOMER X-RAY — footprint completo de um customer (todas as relações)
-- =============================================================================
-- Conta as linhas de TODA tabela relacionada ao customer (diretas via
-- customer_id + indiretas via FK: goals→hours, groups→channels, users→contacts,
-- work_orders→eventos, annotations→respostas, etc).
--
-- Prod-safe: a função é criada em pg_temp (some no fim da sessão) e cada tabela
-- é protegida por to_regclass — tabelas que ainda não existem em prod (ex.
-- entities/consumption_goal* do RFC-0047/0046) são puladas sem erro.
--
-- Uso: cole no runner SQL do /admin/db (ou psql) e troque o UUID no final.
-- =============================================================================

CREATE OR REPLACE FUNCTION pg_temp.customer_xray(p_customer uuid)
RETURNS TABLE(grupo text, tabela text, linhas bigint)
LANGUAGE plpgsql AS $fn$
DECLARE
  specs text[][] := ARRAY[
    ['core',         'customers',                     'id = $1'],
    ['core',         'assets',                        'customer_id = $1'],
    ['core',         'devices',                       'customer_id = $1'],
    ['core',         'centrals',                      'customer_id = $1'],
    ['rules',        'rules',                         'customer_id = $1'],
    ['rules',        'alarm_bundle_versions',         'customer_id = $1'],
    ['groups',       'groups',                        'customer_id = $1'],
    ['groups',       'group_channels',                'group_id IN (SELECT id FROM groups WHERE customer_id = $1)'],
    ['groups',       'group_dispatch_configs',        'group_id IN (SELECT id FROM groups WHERE customer_id = $1)'],
    ['groups',       'maintenance_groups',            'customer_id = $1'],
    ['users',        'users',                         'customer_id = $1'],
    ['users',        'user_contacts',                 'user_id IN (SELECT id FROM users WHERE customer_id = $1)'],
    ['users',        'role_assignments',              'user_id IN (SELECT id FROM users WHERE customer_id = $1)'],
    ['users',        'user_maintenance_groups',       'user_id IN (SELECT id FROM users WHERE customer_id = $1)'],
    ['integration',  'customer_channels',             'customer_id = $1'],
    ['integration',  'customer_api_keys',             'customer_id = $1'],
    ['integration',  'device_sync_jobs',              'customer_id = $1'],
    ['ui',           'look_and_feels',                'customer_id = $1'],
    ['ui',           'templates',                     'customer_id = $1'],
    ['entities',     'entities',                      'customer_id = $1'],
    ['goals',        'consumption_goals',             'customer_id = $1'],
    ['goals',        'consumption_goal_hours',        'goal_id IN (SELECT id FROM consumption_goals WHERE customer_id = $1)'],
    ['goals',        'consumption_goal_history',      'goal_id IN (SELECT id FROM consumption_goals WHERE customer_id = $1)'],
    ['annotations',  'annotations',                   'customer_id = $1'],
    ['annotations',  'annotation_responses',          'annotation_id IN (SELECT id FROM annotations WHERE customer_id = $1)'],
    ['annotations',  'annotation_events',             'annotation_id IN (SELECT id FROM annotations WHERE customer_id = $1)'],
    ['annotations',  'annotation_attachments',        'annotation_id IN (SELECT id FROM annotations WHERE customer_id = $1)'],
    ['annotations',  'annotation_mentions',           'annotation_id IN (SELECT id FROM annotations WHERE customer_id = $1)'],
    ['work_orders',  'work_orders',                   'customer_id = $1'],
    ['work_orders',  'work_orders_customer_settings', 'customer_id = $1'],
    ['work_orders',  'work_orders_devices',           'work_order_id IN (SELECT id FROM work_orders WHERE customer_id = $1)'],
    ['work_orders',  'work_orders_events',            'work_order_id IN (SELECT id FROM work_orders WHERE customer_id = $1)'],
    ['work_orders',  'work_orders_watchers',          'work_order_id IN (SELECT id FROM work_orders WHERE customer_id = $1)'],
    ['work_orders',  'work_orders_ticket_meta',       'work_order_id IN (SELECT id FROM work_orders WHERE customer_id = $1)'],
    ['work_orders',  'work_order_files',              'work_order_id IN (SELECT id FROM work_orders WHERE customer_id = $1)'],
    ['files',        'file_assets',                   'customer_id = $1'],
    ['simulator',    'simulator_sessions',            'customer_id = $1'],
    ['simulator',    'simulator_events',              'session_id IN (SELECT id FROM simulator_sessions WHERE customer_id = $1)'],
    ['audit',        'audit_logs',                    'customer_id = $1']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(specs, 1) LOOP
    IF to_regclass('public.' || specs[i][2]) IS NOT NULL THEN
      RETURN QUERY EXECUTE
        format('SELECT %L::text, %L::text, count(*)::bigint FROM public.%I WHERE %s',
               specs[i][1], specs[i][2], specs[i][2], specs[i][3])
        USING p_customer;
    END IF;
  END LOOP;
END $fn$;

-- ---- foto: só o que tem dado, agrupado ----
SELECT grupo, tabela, linhas
FROM pg_temp.customer_xray('e04046d4-baa4-44e9-a378-4dfebe4140f1')
WHERE linhas > 0
ORDER BY grupo, linhas DESC;

-- total geral:
-- SELECT sum(linhas) AS total_linhas FROM pg_temp.customer_xray('e04046d4-baa4-44e9-a378-4dfebe4140f1');
