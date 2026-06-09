-- =============================================================================
-- OS (QR Checker) demo data load — Customer "Mestre Álvaro"
-- =============================================================================
-- Customer : Mestre Álvaro (e04046d4-baa4-44e9-a378-4dfebe4140f1)
-- Tenant   : 11111111-1111-1111-1111-111111111111
--
-- "OS" in the UI (/os) is the QR Checker domain: it enables a customer for OS,
-- records field installations on devices, maintenance tasks, and technical
-- visits (visitas) with ambientes / products / observations.
--
-- This script:
--   1. Enables OS for the customer            -> wo_customer_settings
--   2. Creates installations on up to 6 of the customer's existing devices
--      (mixed statuses) + an audit row + a couple maintenance tasks
--   3. Creates one technical visit with 2 ambientes, products, an observation
--      and an audit row
--   4. Adds a customer-level OS observation
--
-- Idempotent & safe to re-run:
--   - installations use ON CONFLICT (tenant, device) DO NOTHING
--   - demo visitas and demo customer observations (marked '[DEMO]') are deleted
--     and recreated on each run
-- Everything user-visible is prefixed '[DEMO]' so it is easy to spot and remove.
-- It only references EXISTING devices (FK restrict) — discovered at run time.
--
-- Cleanup (remove all demo data):
--   DELETE FROM wo_visitas_tecnicas
--     WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND name LIKE '[DEMO]%';
--   DELETE FROM wo_customer_observations
--     WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND observation LIKE '[DEMO]%';
--   DELETE FROM wo_installations
--     WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1' AND obs LIKE '[DEMO]%';
--   -- (wo_customer_settings row can be left enabled, or deleted to disable OS)
-- =============================================================================

DO $$
DECLARE
  v_tenant   uuid := '11111111-1111-1111-1111-111111111111';
  v_customer uuid := 'e04046d4-baa4-44e9-a378-4dfebe4140f1';
  v_user     uuid;
  v_central  uuid;
  v_dev      RECORD;
  v_inst     uuid;
  v_visita   uuid;
  v_amb      uuid;
  v_installs int := 0;
  v_tc_types  text[] := ARRAY['100A','400A','50A','1000A','100A','400A'];
  v_statuses  text[] := ARRAY['instalado','instalado','impedimento','instalado','defeito','removido'];
BEGIN
  -- Guard: customer must exist
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = v_customer AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Customer % not found for tenant %', v_customer, v_tenant;
  END IF;

  -- Resolve an actor user (any user in the tenant), fallback to the master system user
  SELECT id INTO v_user FROM users WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    v_user := '00000000-0000-0000-0000-000000000002';  -- master/system user
  END IF;

  -- Resolve a default central for the customer (optional)
  SELECT id INTO v_central FROM centrals
   WHERE tenant_id = v_tenant AND customer_id = v_customer
   LIMIT 1;

  -- 1) Enable OS for the customer ------------------------------------------------
  INSERT INTO wo_customer_settings (customer_id, tenant_id, default_central_id, wo_metadata, created_by)
  VALUES (v_customer, v_tenant, v_central, '{"demo": true}'::jsonb, v_user)
  ON CONFLICT (customer_id) DO UPDATE
    SET default_central_id = COALESCE(wo_customer_settings.default_central_id, EXCLUDED.default_central_id),
        updated_at = now();

  -- 2) Installations on up to 6 existing devices --------------------------------
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
    v_inst := NULL;

    INSERT INTO wo_installations (
      id, tenant_id, device_id, customer_id, position, tc_type,
      impedimento_text, obs, current_multiplier, voltage_multiplier, installed_by
    )
    VALUES (
      gen_random_uuid(), v_tenant, v_dev.id, v_customer,
      'Quadro ' || v_dev.rn,
      v_tc_types[v_dev.rn],
      v_statuses[v_dev.rn],
      '[DEMO] ' || v_dev.dname,
      1.0, 1.0, v_user
    )
    ON CONFLICT (tenant_id, device_id) DO NOTHING
    RETURNING id INTO v_inst;

    IF v_inst IS NOT NULL THEN
      v_installs := v_installs + 1;

      -- audit: created
      INSERT INTO wo_installation_audit (
        tenant_id, installation_id, revision, change_type, change_description, changed_by
      )
      VALUES (v_tenant, v_inst, 1, 'created', '[DEMO] Instalação registrada em campo', v_user);

      -- maintenance task on the problem ones (impedimento / defeito)
      IF v_dev.rn IN (3, 5) THEN
        INSERT INTO wo_maintenance_tasks (
          tenant_id, installation_id, description, status, created_by
        )
        VALUES (
          v_tenant, v_inst,
          '[DEMO] Verificar conexão / TC e refazer leitura',
          'pending', v_user
        );

        INSERT INTO wo_installation_audit (
          tenant_id, installation_id, revision, change_type, change_description, changed_by
        )
        VALUES (v_tenant, v_inst, 2, 'task_created', '[DEMO] Tarefa de manutenção aberta', v_user);
      END IF;
    END IF;
  END LOOP;

  -- 3) Technical visit (idempotent: drop prior demo visitas, cascade) -----------
  DELETE FROM wo_visitas_tecnicas
   WHERE tenant_id = v_tenant AND customer_id = v_customer AND name LIKE '[DEMO]%';

  INSERT INTO wo_visitas_tecnicas (id, tenant_id, customer_id, name, observation, status, created_by)
  VALUES (
    gen_random_uuid(), v_tenant, v_customer,
    '[DEMO] Visita técnica inicial',
    'Levantamento de campo para instalação dos medidores.',
    'in_progress', v_user
  )
  RETURNING id INTO v_visita;

  -- ambiente 1 + product
  INSERT INTO wo_visita_ambientes (
    id, tenant_id, visita_id, name, observation, ac_quantity, product_quantity, product_type, created_by
  )
  VALUES (
    gen_random_uuid(), v_tenant, v_visita, 'Sala de Máquinas',
    'Acesso pelo subsolo; quadro geral fica à esquerda.', 2, 3, 'sensor', v_user
  )
  RETURNING id INTO v_amb;

  INSERT INTO wo_visita_products (tenant_id, ambiente_id, product_type, description, quantity, created_by)
  VALUES (v_tenant, v_amb, 'sensor', '[DEMO] Sensor de corrente (TC)', 3, v_user);

  -- ambiente 2 + product
  INSERT INTO wo_visita_ambientes (
    id, tenant_id, visita_id, name, observation, ac_quantity, product_quantity, product_type, created_by
  )
  VALUES (
    gen_random_uuid(), v_tenant, v_visita, 'Hall de Entrada',
    NULL, 1, 1, 'gateway', v_user
  )
  RETURNING id INTO v_amb;

  INSERT INTO wo_visita_products (tenant_id, ambiente_id, product_type, description, quantity, created_by)
  VALUES (v_tenant, v_amb, 'gateway', '[DEMO] Central NodeHub', 1, v_user);

  -- visit observation + audit
  INSERT INTO wo_visita_observations (tenant_id, visita_id, observation, created_by)
  VALUES (v_tenant, v_visita, '[DEMO] Cliente solicitou retorno na próxima semana para concluir.', v_user);

  INSERT INTO wo_visita_audit (tenant_id, visita_id, revision, change_type, change_description, changed_by)
  VALUES (v_tenant, v_visita, 1, 'created', '[DEMO] Visita técnica criada', v_user);

  -- 4) Customer-level OS observation (idempotent) -------------------------------
  DELETE FROM wo_customer_observations
   WHERE tenant_id = v_tenant AND customer_id = v_customer AND observation LIKE '[DEMO]%';

  INSERT INTO wo_customer_observations (tenant_id, customer_id, observation, created_by)
  VALUES (v_tenant, v_customer, '[DEMO] Observação geral de OS do cliente (carga demo).', v_user);

  RAISE NOTICE 'OS demo load OK — customer %, installations created/kept this run: %, visita: %',
    v_customer, v_installs, v_visita;
END $$;

-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'os_enabled'   AS what, count(*) AS n FROM wo_customer_settings   WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
UNION ALL
SELECT 'installations', count(*)            FROM wo_installations        WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
UNION ALL
SELECT 'maint_tasks',   count(*)            FROM wo_maintenance_tasks    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
   AND installation_id IN (SELECT id FROM wo_installations WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1')
UNION ALL
SELECT 'visitas',       count(*)            FROM wo_visitas_tecnicas     WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
UNION ALL
SELECT 'ambientes',     count(*)            FROM wo_visita_ambientes     WHERE visita_id IN (SELECT id FROM wo_visitas_tecnicas WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1')
UNION ALL
SELECT 'cust_obs',      count(*)            FROM wo_customer_observations WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1';
