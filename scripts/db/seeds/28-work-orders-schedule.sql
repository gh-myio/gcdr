-- =============================================================================
-- Seed 28 — Work Orders future schedule  [feeds /os "Proximas agendas" + "Agenda Alocacoes"]
-- =============================================================================
-- Future-scheduled work orders so the schedule-oriented tabs have data:
--   * 8 weeks ahead (next Monday onward), 5 WOs per weekday-week (40 total)
--   * assigned round-robin to the 4 technicians from seed 27; ~1 in 5 left
--     UNASSIGNED to populate the "Sem responsavel" row in the allocations board
--   * ~1 in 7 marked REAGENDADA (with a reschedule event + previous date)
--   * type rotates INSTALACAO / MANUTENCAO / VISITA_TECNICA
--
-- Self-sufficient: re-inserts the technicians + customer WO settings via
-- ON CONFLICT DO NOTHING, so it runs with or without seed 27. Deterministic ids
-- (a028… WOs, e028… events) make it idempotent.
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
  v_types text[] := ARRAY['INSTALACAO', 'MANUTENCAO', 'VISITA_TECNICA'];

  -- Next Monday 00:00 (date_trunc('week') is Monday-based in Postgres).
  v_base_monday timestamptz := date_trunc('week', now()) + interval '7 days';

  w int; d int;
  g int := 0;
  seq int;
  v_wo_id uuid;
  v_sched timestamptz;
  v_type text;
  v_assigned uuid;
  v_assigned_idx int;
  v_status text;
  v_reagendada boolean;
  v_actor jsonb;
  v_admin_actor jsonb := jsonb_build_object('id', v_admin, 'email', 'admin@gcdr.io', 'name', 'Admin');
BEGIN
  -- ── Technicians (idempotent) ──────────────────────────────────────────────
  FOR d IN 1..4 LOOP
    INSERT INTO users (
      id, tenant_id, customer_id, email, email_verified, username, type, status, profile, version
    ) VALUES (
      v_tech_ids[d], v_tenant, v_customer, v_tech_emails[d], true,
      split_part(v_tech_emails[d], '@', 1), 'INTERNAL', 'ACTIVE',
      jsonb_build_object('displayName', v_tech_names[d], 'jobTitle', 'Técnico de Campo'),
      1
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  INSERT INTO work_orders_customer_settings (customer_id, tenant_id, wo_metadata, created_by)
  VALUES (v_customer, v_tenant, '{}'::jsonb, v_admin)
  ON CONFLICT (customer_id) DO NOTHING;

  -- ── Future-scheduled work orders ──────────────────────────────────────────
  FOR w IN 0..7 LOOP            -- 8 weeks ahead
    FOR d IN 0..4 LOOP          -- Monday .. Friday
      v_wo_id := ('a0280000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid;
      v_type  := v_types[(g % 3) + 1];

      -- Working-hour slot: 08:00–15:00, half-hour jitter.
      v_sched := v_base_monday
                 + (w * 7 + d || ' days')::interval
                 + ((8 + (g % 8)) || ' hours')::interval
                 + ((g % 2) * 30 || ' minutes')::interval;

      -- 1 in 5 stays unassigned (populates the allocations "unassigned" row).
      v_assigned_idx := g % 5;
      v_assigned := CASE WHEN v_assigned_idx < 4 THEN v_tech_ids[v_assigned_idx + 1] ELSE NULL END;

      v_reagendada := (g % 7) = 6;
      v_status := CASE WHEN v_reagendada THEN 'REAGENDADA' ELSE 'PLANEJADA' END;

      seq := 0;

      INSERT INTO work_orders (
        id, tenant_id, customer_id, root_asset_id, type, status, code,
        assigned_to, scheduled_at, created_by, created_at, updated_at
      ) VALUES (
        v_wo_id, v_tenant, v_customer, v_asset, v_type, v_status,
        'OS-AGD' || lpad((g + 1)::text, 3, '0'),
        v_assigned, v_sched, v_admin,
        now() - interval '2 days', now() - interval '1 day'
      )
      ON CONFLICT (id) DO NOTHING;

      -- WO_CRIADA
      INSERT INTO work_orders_events (
        id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at
      ) VALUES (
        ('e0280000-0000-0000-' || lpad(to_hex(g), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
        v_tenant, v_wo_id, 'WO_CRIADA', 'USER', v_admin, v_admin_actor,
        jsonb_build_object('type', v_type, 'customerId', v_customer),
        now() - interval '2 days'
      )
      ON CONFLICT (id) DO NOTHING;
      seq := seq + 1;

      -- WO_ATRIBUIDA (only when assigned)
      IF v_assigned IS NOT NULL THEN
        v_actor := jsonb_build_object(
          'id', v_assigned,
          'email', v_tech_emails[v_assigned_idx + 1],
          'name', v_tech_names[v_assigned_idx + 1]
        );
        INSERT INTO work_orders_events (
          id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at
        ) VALUES (
          ('e0280000-0000-0000-' || lpad(to_hex(g), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
          v_tenant, v_wo_id, 'WO_ATRIBUIDA', 'USER', v_admin, v_admin_actor,
          jsonb_build_object('assignedTo', v_assigned),
          now() - interval '2 days' + interval '3 minutes'
        )
        ON CONFLICT (id) DO NOTHING;
        seq := seq + 1;
      END IF;

      -- Lifecycle: planned (and, for the rescheduled ones, a REAGENDADA marker)
      INSERT INTO work_orders_events (
        id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at
      ) VALUES (
        ('e0280000-0000-0000-' || lpad(to_hex(g), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
        v_tenant, v_wo_id, v_type || '_PLANEJADA', 'USER', v_admin, v_admin_actor,
        jsonb_build_object('scheduledAt', v_sched),
        now() - interval '1 day'
      )
      ON CONFLICT (id) DO NOTHING;
      seq := seq + 1;

      IF v_reagendada THEN
        INSERT INTO work_orders_events (
          id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at
        ) VALUES (
          ('e0280000-0000-0000-' || lpad(to_hex(g), 4, '0') || '-' || lpad(to_hex(seq), 12, '0'))::uuid,
          v_tenant, v_wo_id, v_type || '_REAGENDADA', 'USER',
          COALESCE(v_assigned, v_admin), COALESCE(v_actor, v_admin_actor),
          jsonb_build_object(
            'previousScheduledAt', v_sched - interval '5 days',
            'scheduledAt', v_sched,
            'reason', 'Reagendado a pedido do cliente.'
          ),
          now() - interval '12 hours'
        )
        ON CONFLICT (id) DO NOTHING;
        seq := seq + 1;
      END IF;

      g := g + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seed 28: % future-scheduled work orders over 8 weeks (next Monday %)',
    g, v_base_monday::date;
END $$;
