-- =============================================================================
-- Seed 27 — Work Orders performance campaign  [feeds the /os "Desempenho" tab]
-- =============================================================================
-- A realistic installation campaign for the Dimension customer so the
-- Performance tab has data to aggregate:
--   * 4 technicians (users) — Carlos, Ana, Marcos, Juliana
--   * 24 INSTALACAO work orders (OS-PRF001 … OS-PRF024)
--   * ~312 metering devices, 283 of them installed (PRODUTO_INSTALADO events)
--     → progress ≈ 91%, echoing the reference dashboard.
--
-- Each work order is handled by one technician (round-robin) on one day
-- (2 WOs per day → 12 days, 2 technicians active per day). Install events are
-- spaced 25–95 min apart so the tab's gap-based time model produces sensible
-- per-technician / per-day totals. The last 3 WOs stay EM_ANDAMENTO with only
-- part of their devices installed, leaving an open backlog.
--
-- Deterministic ids (prefix 2227… devices, a027… WOs, e027… events,
-- bbbb700x technicians) + ON CONFLICT DO NOTHING → safe to re-run.
-- =============================================================================

DO $$
DECLARE
  v_tenant     uuid := '11111111-1111-1111-1111-111111111111';
  v_customer   uuid := '77777777-7777-7777-7777-777777777777';  -- Dimension
  v_asset      uuid := 'dddd2222-2222-2222-2222-222222222222';  -- Dimension lab
  v_admin      uuid := 'bbbb1111-1111-1111-1111-111111111111';

  v_tech_ids    uuid[] := ARRAY[
    'bbbb7001-0001-0001-0001-000000000001',
    'bbbb7002-0002-0002-0002-000000000002',
    'bbbb7003-0003-0003-0003-000000000003',
    'bbbb7004-0004-0004-0004-000000000004'
  ]::uuid[];
  v_tech_names  text[] := ARRAY['Carlos Pereira', 'Ana Souza', 'Marcos Lima', 'Juliana Alves'];
  v_tech_emails text[] := ARRAY[
    'carlos.pereira@dimension.io',
    'ana.souza@dimension.io',
    'marcos.lima@dimension.io',
    'juliana.alves@dimension.io'
  ];

  c_n_wo   int := 24;  -- total work orders
  c_per_wo int := 13;  -- devices scoped per work order  (24*13 = 312 devices)

  v_campaign_start timestamptz := date_trunc('day', now()) - interval '13 days';

  w int; i int; t int;
  g int := 0;            -- global device counter
  seq int;               -- per-WO event counter (keeps event ids unique)
  v_tech int;
  v_day int;
  v_wo_id uuid;
  v_dev_id uuid;
  v_wo_start timestamptz;
  v_cursor   timestamptz;
  v_installed int;
  v_status text;
  v_gap int;
  v_actor jsonb;
BEGIN
  -- ── Technicians ───────────────────────────────────────────────────────────
  FOR t IN 1..4 LOOP
    INSERT INTO users (
      id, tenant_id, customer_id, email, email_verified, username, type, status, profile, version
    ) VALUES (
      v_tech_ids[t], v_tenant, v_customer, v_tech_emails[t], true,
      split_part(v_tech_emails[t], '@', 1), 'INTERNAL', 'ACTIVE',
      jsonb_build_object(
        'displayName', v_tech_names[t],
        'firstName',   split_part(v_tech_names[t], ' ', 1),
        'lastName',    split_part(v_tech_names[t], ' ', 2),
        'jobTitle',    'Técnico de Campo'
      ),
      1
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- ── Ensure the customer is WO-enabled ─────────────────────────────────────
  INSERT INTO work_orders_customer_settings (customer_id, tenant_id, wo_metadata, created_by)
  VALUES (v_customer, v_tenant, '{}'::jsonb, v_admin)
  ON CONFLICT (customer_id) DO NOTHING;

  -- ── Work orders + devices + install events ────────────────────────────────
  FOR w IN 0..(c_n_wo - 1) LOOP
    v_wo_id    := ('a0270000-0000-0000-0000-' || lpad(to_hex(w), 12, '0'))::uuid;
    v_tech     := (w % 4) + 1;
    v_day      := w / 2;  -- integer division → 2 WOs per day
    v_wo_start := v_campaign_start + (v_day || ' days')::interval + interval '8 hours';
    v_actor    := jsonb_build_object(
                    'id',    v_tech_ids[v_tech],
                    'email', v_tech_emails[v_tech],
                    'name',  v_tech_names[v_tech]
                  );

    -- Most WOs finish fully; the last three taper off (leaves ~29 pending).
    IF w <= 20 THEN
      v_installed := c_per_wo; v_status := 'FINALIZADA';
    ELSIF w = 21 THEN
      v_installed := 4; v_status := 'EM_ANDAMENTO';
    ELSIF w = 22 THEN
      v_installed := 3; v_status := 'EM_ANDAMENTO';
    ELSE
      v_installed := 3; v_status := 'EM_ANDAMENTO';
    END IF;

    seq := 0;

    INSERT INTO work_orders (
      id, tenant_id, customer_id, root_asset_id, type, status, code,
      assigned_to, scheduled_at, created_by, created_at, updated_at
    ) VALUES (
      v_wo_id, v_tenant, v_customer, v_asset, 'INSTALACAO', v_status,
      'OS-PRF' || lpad((w + 1)::text, 3, '0'),
      v_tech_ids[v_tech], NULL, v_admin,
      v_wo_start - interval '1 day', v_wo_start + interval '7 hours'
    )
    ON CONFLICT (id) DO NOTHING;

    -- Lifecycle: created → assigned → started
    INSERT INTO work_orders_events (
      id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at
    ) VALUES (
      ('e0270000-0000-0000-' || lpad(to_hex(w), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
      v_tenant, v_wo_id, 'WO_CRIADA', 'USER', v_admin,
      jsonb_build_object('id', v_admin, 'email', 'admin@gcdr.io', 'name', 'Admin'),
      jsonb_build_object('type', 'INSTALACAO', 'customerId', v_customer),
      v_wo_start - interval '1 day'
    )
    ON CONFLICT (id) DO NOTHING;
    seq := seq + 1;

    INSERT INTO work_orders_events (
      id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at
    ) VALUES (
      ('e0270000-0000-0000-' || lpad(to_hex(w), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
      v_tenant, v_wo_id, 'WO_ATRIBUIDA', 'USER', v_admin,
      jsonb_build_object('id', v_admin, 'email', 'admin@gcdr.io', 'name', 'Admin'),
      jsonb_build_object('assignedTo', v_tech_ids[v_tech]),
      v_wo_start - interval '1 day' + interval '5 minutes'
    )
    ON CONFLICT (id) DO NOTHING;
    seq := seq + 1;

    INSERT INTO work_orders_events (
      id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at
    ) VALUES (
      ('e0270000-0000-0000-' || lpad(to_hex(w), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
      v_tenant, v_wo_id, 'INSTALACAO_INICIADA', 'USER', v_tech_ids[v_tech], v_actor,
      jsonb_build_object('note', 'Equipe em campo.'),
      v_wo_start
    )
    ON CONFLICT (id) DO NOTHING;
    seq := seq + 1;

    -- Devices + per-device install events
    v_cursor := v_wo_start + interval '20 minutes';
    FOR i IN 0..(c_per_wo - 1) LOOP
      v_dev_id := ('22270000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid;

      INSERT INTO devices (
        id, tenant_id, asset_id, customer_id, name, display_name, label, type,
        serial_number, device_profile, status, version
      ) VALUES (
        v_dev_id, v_tenant, v_asset, v_customer,
        'Medidor ' || (g + 1),
        'Medidor de Energia ' || (g + 1),
        'MED-' || lpad((g + 1)::text, 4, '0'),
        'METER',
        'SN-PRF-' || lpad((g + 1)::text, 5, '0'),
        'ENERGY_METER',
        'ACTIVE', 1
      )
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO work_orders_devices (work_order_id, device_id, added_by, added_at)
      VALUES (v_wo_id, v_dev_id, v_admin, v_wo_start)
      ON CONFLICT (work_order_id, device_id) DO NOTHING;

      IF i < v_installed THEN
        v_gap := 25 + ((i * 37 + w * 13) % 71);  -- 25–95 min between installs
        v_cursor := v_cursor + (v_gap || ' minutes')::interval;

        INSERT INTO work_orders_events (
          id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor,
          device_id, payload, created_at
        ) VALUES (
          ('e0270000-0000-0000-' || lpad(to_hex(w), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
          v_tenant, v_wo_id, 'PRODUTO_INSTALADO', 'USER', v_tech_ids[v_tech], v_actor,
          v_dev_id,
          jsonb_build_object('deviceId', v_dev_id, 'serial', 'SN-PRF-' || lpad((g + 1)::text, 5, '0')),
          v_cursor
        )
        ON CONFLICT (id) DO NOTHING;
        seq := seq + 1;
      END IF;

      g := g + 1;
    END LOOP;

    -- Close the fully-installed work orders.
    IF v_status = 'FINALIZADA' THEN
      INSERT INTO work_orders_events (
        id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at
      ) VALUES (
        ('e0270000-0000-0000-' || lpad(to_hex(w), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
        v_tenant, v_wo_id, 'INSTALACAO_FINALIZADA', 'USER', v_tech_ids[v_tech], v_actor,
        jsonb_build_object('note', 'Instalação concluída, sem pendências.'),
        v_cursor + interval '15 minutes'
      )
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END LOOP;

  RAISE NOTICE 'Seed 27: % work orders, % devices, technicians %',
    c_n_wo, g, array_to_string(v_tech_names, ', ');
END $$;
