-- =============================================================================
-- OS (Work Orders — RFC-0037 event model) demo data load — Customer "Mestre Álvaro"
-- =============================================================================
-- Customer : Mestre Álvaro (e04046d4-baa4-44e9-a378-4dfebe4140f1)
-- Tenant   : 11111111-1111-1111-1111-111111111111
--
-- "OS" in the UI (/os) is the Work-Orders domain (RFC-0037): a work_order has a
-- type (INSTALACAO | MANUTENCAO | VISITA_TECNICA), an append-only event log
-- (work_orders_events) and a projected `status` derived from its latest
-- lifecycle event. Field notes / observations are polymorphic `annotations`
-- (RFC-0036) targeting entity_type='work_order'.
--
-- This script (all data prefixed '[DEMO]', idempotent / safe to re-run):
--   1. Enables OS for the customer                 -> work_orders_customer_settings
--   2. Creates up to 6 INSTALACAO work orders on the customer's existing devices
--      (one device each, mixed projected statuses) with a lifecycle event chain
--      WO_CRIADA -> *_PLANEJADA -> *_INICIADA -> <final>. The two "problem"
--      orders also get a 'maintenance' annotation (replaces wo_maintenance_tasks).
--   3. Creates one VISITA_TECNICA work order with structural AMBIENTE_CRIADO /
--      PRODUTO_INSTALADO events (replaces wo_visita_ambientes / wo_visita_products)
--      and two 'observation' annotations.
--
-- Status projection (mirrors WorkOrderService.lifecycleStateForCode):
--   *_PLANEJADA -> PLANEJADA   *_INICIADA/_REINICIADA/_EXECUTADA_PARCIAL -> EM_ANDAMENTO
--   *_INTERROMPIDA -> INTERROMPIDA   *_REAGENDADA -> REAGENDADA
--   *_AGUARDANDO_* -> AGUARDANDO   *_FINALIZADA -> FINALIZADA   *_CANCELADA -> CANCELADA
--   (OBSERVACAO / ANEXO / ESTRUTURA events never move status.)
--
-- Cleanup (remove all demo data):
--   DELETE FROM annotations
--     WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND text LIKE '[DEMO]%';
--   DELETE FROM work_orders
--     WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND code LIKE '[DEMO]%';
--   -- (work_orders delete CASCADEs its events/devices/files; annotations are
--   --  polymorphic with no FK to work_orders, so they are deleted separately.)
--   -- work_orders_customer_settings row can be left enabled, or deleted to disable OS.
-- =============================================================================

DO $$
DECLARE
  v_tenant   uuid := '11111111-1111-1111-1111-111111111111';
  v_customer uuid := 'e04046d4-baa4-44e9-a378-4dfebe4140f1';
  v_user     uuid;
  v_email    text;
  v_actor    jsonb;
  v_central  uuid;
  v_dev      RECORD;
  v_wo       uuid;
  v_ann      uuid;
  v_visita   uuid;
  v_installs int := 0;
  v_rn       int;
  v_dname    text;
  -- per-device-index (1..6) scenario tables
  v_final_event  text[] := ARRAY['INSTALACAO_FINALIZADA','INSTALACAO_FINALIZADA','INSTALACAO_AGUARDANDO_OUTROS_MOTIVOS','INSTALACAO_FINALIZADA','INSTALACAO_INTERROMPIDA','INSTALACAO_CANCELADA'];
  v_final_status text[] := ARRAY['FINALIZADA','FINALIZADA','AGUARDANDO','FINALIZADA','INTERROMPIDA','CANCELADA'];
  v_tc_types     text[] := ARRAY['100A','400A','50A','1000A','100A','400A'];
BEGIN
  -- Guard: customer must exist
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = v_customer AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Customer % not found for tenant %', v_customer, v_tenant;
  END IF;

  -- Resolve an actor user (any user in the tenant), fallback to the master system user
  SELECT id, email INTO v_user, v_email
    FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    v_user  := '00000000-0000-0000-0000-000000000002';  -- master/system user
    v_email := 'system@myio';
  END IF;
  v_email := COALESCE(v_email, 'system@myio');
  v_actor := jsonb_build_object('id', v_user, 'email', v_email,
                                'name', initcap(split_part(v_email, '@', 1)));

  -- Resolve a default central for the customer (optional)
  SELECT id INTO v_central FROM centrals
   WHERE tenant_id = v_tenant AND customer_id = v_customer
   LIMIT 1;

  -- Idempotency: drop any prior demo data first ---------------------------------
  DELETE FROM annotations
   WHERE tenant_id = v_tenant AND customer_id = v_customer AND text LIKE '[DEMO]%';
  DELETE FROM work_orders
   WHERE tenant_id = v_tenant AND customer_id = v_customer AND code LIKE '[DEMO]%';

  -- 1) Enable OS for the customer ------------------------------------------------
  INSERT INTO work_orders_customer_settings (customer_id, tenant_id, default_central_id, wo_metadata, created_by)
  VALUES (v_customer, v_tenant, v_central, '{"demo": true}'::jsonb, v_user)
  ON CONFLICT (customer_id) DO UPDATE
    SET default_central_id = COALESCE(work_orders_customer_settings.default_central_id, EXCLUDED.default_central_id),
        updated_at = now();

  -- 2) INSTALACAO work orders on up to 6 existing devices -----------------------
  FOR v_dev IN
    SELECT id,
           COALESCE(display_name, name) AS dname,
           (ROW_NUMBER() OVER (ORDER BY created_at))::int AS rn
      FROM devices
     WHERE tenant_id = v_tenant
       AND customer_id = v_customer
       AND status = 'ACTIVE'
       AND deleted_at IS NULL
     ORDER BY created_at
     LIMIT 6
  LOOP
    v_rn    := v_dev.rn;
    v_dname := v_dev.dname;

    -- work order (status set to the projected value of its final lifecycle event)
    INSERT INTO work_orders (id, tenant_id, customer_id, type, status, code, assigned_to, scheduled_at, created_by)
    VALUES (gen_random_uuid(), v_tenant, v_customer, 'INSTALACAO',
            v_final_status[v_rn], '[DEMO] Instalação — ' || v_dname,
            v_user, now(), v_user)
    RETURNING id INTO v_wo;
    v_installs := v_installs + 1;

    -- device scope
    INSERT INTO work_orders_devices (work_order_id, device_id, added_by)
    VALUES (v_wo, v_dev.id, v_user);

    -- lifecycle event chain (clock_timestamp() => strictly increasing created_at,
    -- so the final row is the "latest" the projection would pick)
    INSERT INTO work_orders_events
      (tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, device_id, payload, created_at)
    VALUES
      (v_tenant, v_wo, 'WO_CRIADA',            'USER', v_user, v_actor, v_dev.id,
       jsonb_build_object('type','INSTALACAO','tc', v_tc_types[v_rn]),      clock_timestamp()),
      (v_tenant, v_wo, 'INSTALACAO_PLANEJADA', 'USER', v_user, v_actor, v_dev.id,
       jsonb_build_object('position','Quadro ' || v_rn),                    clock_timestamp()),
      (v_tenant, v_wo, 'INSTALACAO_INICIADA',  'USER', v_user, v_actor, v_dev.id,
       jsonb_build_object('currentMultiplier',1.0,'voltageMultiplier',1.0), clock_timestamp()),
      (v_tenant, v_wo, v_final_event[v_rn],    'USER', v_user, v_actor, v_dev.id,
       jsonb_build_object('note','[DEMO] ' || v_dname),                     clock_timestamp());

    -- problem orders (impedimento / defeito): maintenance annotation on the WO
    IF v_rn IN (3, 5) THEN
      INSERT INTO annotations
        (tenant_id, customer_id, entity_type, entity_id, text, type, importance, created_by)
      VALUES
        (v_tenant, v_customer, 'work_order', v_wo,
         '[DEMO] Verificar conexão / TC e refazer leitura — ' || v_dname,
         'maintenance', 4, v_actor)
      RETURNING id INTO v_ann;

      INSERT INTO annotation_events (tenant_id, annotation_id, action, actor)
      VALUES (v_tenant, v_ann, 'created', v_actor);
    END IF;
  END LOOP;

  -- 3) VISITA_TECNICA work order (structural ambiente/produto events) -----------
  INSERT INTO work_orders (id, tenant_id, customer_id, type, status, code, scheduled_at, created_by)
  VALUES (gen_random_uuid(), v_tenant, v_customer, 'VISITA_TECNICA',
          'EM_ANDAMENTO', '[DEMO] Visita técnica inicial', now(), v_user)
  RETURNING id INTO v_visita;

  INSERT INTO work_orders_events
    (tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at)
  VALUES
    (v_tenant, v_visita, 'WO_CRIADA',                 'USER', v_user, v_actor,
     jsonb_build_object('type','VISITA_TECNICA'),                                   clock_timestamp()),
    (v_tenant, v_visita, 'VISITA_TECNICA_PLANEJADA',  'USER', v_user, v_actor,
     '{}'::jsonb,                                                                   clock_timestamp()),
    (v_tenant, v_visita, 'VISITA_TECNICA_INICIADA',   'USER', v_user, v_actor,
     jsonb_build_object('note','Levantamento de campo para instalação dos medidores.'), clock_timestamp()),
    (v_tenant, v_visita, 'AMBIENTE_CRIADO',           'USER', v_user, v_actor,
     jsonb_build_object('name','Sala de Máquinas','acQuantity',2,'productQuantity',3,
                        'observation','Acesso pelo subsolo; quadro geral à esquerda.'), clock_timestamp()),
    (v_tenant, v_visita, 'PRODUTO_INSTALADO',         'USER', v_user, v_actor,
     jsonb_build_object('ambiente','Sala de Máquinas','productType','sensor',
                        'description','[DEMO] Sensor de corrente (TC)','quantity',3), clock_timestamp()),
    (v_tenant, v_visita, 'AMBIENTE_CRIADO',           'USER', v_user, v_actor,
     jsonb_build_object('name','Hall de Entrada','acQuantity',1,'productQuantity',1), clock_timestamp()),
    (v_tenant, v_visita, 'PRODUTO_INSTALADO',         'USER', v_user, v_actor,
     jsonb_build_object('ambiente','Hall de Entrada','productType','gateway',
                        'description','[DEMO] Central NodeHub','quantity',1),         clock_timestamp());

  -- visit observation annotation
  INSERT INTO annotations
    (tenant_id, customer_id, entity_type, entity_id, text, type, importance, created_by)
  VALUES
    (v_tenant, v_customer, 'work_order', v_visita,
     '[DEMO] Cliente solicitou retorno na próxima semana para concluir.',
     'observation', 3, v_actor)
  RETURNING id INTO v_ann;
  INSERT INTO annotation_events (tenant_id, annotation_id, action, actor)
  VALUES (v_tenant, v_ann, 'created', v_actor);

  -- general observation (customer-level note; modeled on the visita WO since the
  -- annotation entity_type domain is device | work_order | work_order_event)
  INSERT INTO annotations
    (tenant_id, customer_id, entity_type, entity_id, text, type, importance, created_by)
  VALUES
    (v_tenant, v_customer, 'work_order', v_visita,
     '[DEMO] Observação geral de OS do cliente (carga demo).',
     'observation', 2, v_actor)
  RETURNING id INTO v_ann;
  INSERT INTO annotation_events (tenant_id, annotation_id, action, actor)
  VALUES (v_tenant, v_ann, 'created', v_actor);

  RAISE NOTICE 'OS demo load OK — customer %, INSTALACAO work orders: %, visita: %',
    v_customer, v_installs, v_visita;
END $$;

-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'os_enabled'    AS what, count(*) AS n FROM work_orders_customer_settings WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
UNION ALL
SELECT 'work_orders',  count(*) FROM work_orders        WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND code LIKE '[DEMO]%'
UNION ALL
SELECT 'wo_events',    count(*) FROM work_orders_events WHERE work_order_id IN (SELECT id FROM work_orders WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND code LIKE '[DEMO]%')
UNION ALL
SELECT 'wo_devices',   count(*) FROM work_orders_devices WHERE work_order_id IN (SELECT id FROM work_orders WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND code LIKE '[DEMO]%')
UNION ALL
SELECT 'annotations',  count(*) FROM annotations        WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND text LIKE '[DEMO]%';

-- status breakdown of the demo work orders
SELECT type, status, count(*) AS n
  FROM work_orders
 WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND code LIKE '[DEMO]%'
 GROUP BY type, status
 ORDER BY type, status;
