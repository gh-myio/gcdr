-- =============================================================================
-- Seed 26 — Work Orders (OS) demo  [RFC-0037 event model + RFC-0036 annotations]
-- =============================================================================
-- Three demo work orders for the Dimension customer, one per type and in a
-- different lifecycle state, so the /os module has data to explore locally:
--   * OS-MNT2K7  MANUTENCAO     EM_ANDAMENTO  (devices + 2 technicians + notes)
--   * OS-INS3P9  INSTALACAO     PLANEJADA     (device scope only)
--   * OS-VTC4R8  VISITA_TECNICA FINALIZADA    (full lifecycle)
--
-- status is set here to match the latest lifecycle event (the app projects it
-- from events; seeds set it directly). Idempotent via ON CONFLICT DO NOTHING.
--
-- Fixed ids (tenant 1111…, customer Dimension 7777…, admin bbbb1111,
-- service bbbb5555, assets dddd1111/dddd2222, devices 22220001-…-00N).
-- =============================================================================

-- Enable the customer for the WO module.
INSERT INTO work_orders_customer_settings (customer_id, tenant_id, wo_metadata, created_by)
VALUES (
  '77777777-7777-7777-7777-777777777777',
  '11111111-1111-1111-1111-111111111111',
  '{}'::jsonb,
  'bbbb1111-1111-1111-1111-111111111111'
)
ON CONFLICT (customer_id) DO NOTHING;

-- ── Work orders ─────────────────────────────────────────────────────────────
INSERT INTO work_orders (id, tenant_id, customer_id, root_asset_id, type, status, code, assigned_to, scheduled_at, created_by, created_at, updated_at)
VALUES
  ('a0000001-0001-0001-0001-000000000001', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777',
   'dddd2222-2222-2222-2222-222222222222', 'MANUTENCAO', 'EM_ANDAMENTO', 'OS-MNT2K7',
   'bbbb1111-1111-1111-1111-111111111111', now() + interval '1 day',
   'bbbb1111-1111-1111-1111-111111111111', now() - interval '2 days', now() - interval '3 hours'),

  ('a0000002-0002-0002-0002-000000000002', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777',
   'dddd1111-1111-1111-1111-111111111111', 'INSTALACAO', 'PLANEJADA', 'OS-INS3P9',
   NULL, now() + interval '5 days',
   'bbbb1111-1111-1111-1111-111111111111', now() - interval '1 day', now() - interval '1 day'),

  ('a0000003-0003-0003-0003-000000000003', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777',
   'dddd1111-1111-1111-1111-111111111111', 'VISITA_TECNICA', 'FINALIZADA', 'OS-VTC4R8',
   'bbbb5555-5555-5555-5555-555555555555', NULL,
   'bbbb1111-1111-1111-1111-111111111111', now() - interval '10 days', now() - interval '7 days')
ON CONFLICT (id) DO NOTHING;

-- ── Device scope ────────────────────────────────────────────────────────────
INSERT INTO work_orders_devices (work_order_id, device_id, added_by, added_at)
VALUES
  ('a0000001-0001-0001-0001-000000000001', '22220001-0001-0001-0001-000000000001', 'bbbb1111-1111-1111-1111-111111111111', now() - interval '2 days'),
  ('a0000001-0001-0001-0001-000000000001', '22220001-0001-0001-0001-000000000003', 'bbbb1111-1111-1111-1111-111111111111', now() - interval '2 days'),
  ('a0000002-0002-0002-0002-000000000002', '22220001-0001-0001-0001-000000000004', 'bbbb1111-1111-1111-1111-111111111111', now() - interval '1 day'),
  ('a0000003-0003-0003-0003-000000000003', '22220001-0001-0001-0001-000000000005', 'bbbb1111-1111-1111-1111-111111111111', now() - interval '10 days')
ON CONFLICT (work_order_id, device_id) DO NOTHING;

-- ── Timeline events ─────────────────────────────────────────────────────────
-- Actor snapshots are inlined so names survive without a join.
INSERT INTO work_orders_events (id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, asset_id, device_id, payload, created_at)
VALUES
  -- WO A (MANUTENCAO → EM_ANDAMENTO)
  ('e0000001-0001-0001-0001-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000001-0001-0001-0001-000000000001', 'WO_CRIADA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, NULL, NULL, '{"type":"MANUTENCAO","customerId":"77777777-7777-7777-7777-777777777777"}'::jsonb, now() - interval '2 days'),
  ('e0000001-0001-0001-0001-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000001-0001-0001-0001-000000000001', 'WO_ATRIBUIDA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, NULL, NULL, '{"assignedTo":"bbbb1111-1111-1111-1111-111111111111"}'::jsonb, now() - interval '2 days' + interval '5 minutes'),
  ('e0000001-0001-0001-0001-000000000003', '11111111-1111-1111-1111-111111111111', 'a0000001-0001-0001-0001-000000000001', 'WO_ATRIBUIDA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, NULL, NULL, '{"assignedTo":"bbbb5555-5555-5555-5555-555555555555"}'::jsonb, now() - interval '2 days' + interval '6 minutes'),
  ('e0000001-0001-0001-0001-000000000004', '11111111-1111-1111-1111-111111111111', 'a0000001-0001-0001-0001-000000000001', 'MANUTENCAO_PLANEJADA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, NULL, NULL, '{}'::jsonb, now() - interval '2 days' + interval '10 minutes'),
  ('e0000001-0001-0001-0001-000000000005', '11111111-1111-1111-1111-111111111111', 'a0000001-0001-0001-0001-000000000001', 'MANUTENCAO_INICIADA', 'USER', 'bbbb5555-5555-5555-5555-555555555555', '{"id":"bbbb5555-5555-5555-5555-555555555555","email":"service@gcdr.io","name":"Integration Service"}'::jsonb, NULL, NULL, '{"note":"Equipe em campo, iniciando inspeção."}'::jsonb, now() - interval '3 hours'),

  -- WO B (INSTALACAO → PLANEJADA)
  ('e0000002-0002-0002-0002-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000002-0002-0002-0002-000000000002', 'WO_CRIADA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, NULL, NULL, '{"type":"INSTALACAO","customerId":"77777777-7777-7777-7777-777777777777"}'::jsonb, now() - interval '1 day'),
  ('e0000002-0002-0002-0002-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000002-0002-0002-0002-000000000002', 'INSTALACAO_PLANEJADA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, NULL, NULL, '{}'::jsonb, now() - interval '1 day' + interval '2 minutes'),

  -- WO C (VISITA_TECNICA → FINALIZADA)
  ('e0000003-0003-0003-0003-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000003-0003-0003-0003-000000000003', 'WO_CRIADA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, NULL, NULL, '{"type":"VISITA_TECNICA","customerId":"77777777-7777-7777-7777-777777777777"}'::jsonb, now() - interval '10 days'),
  ('e0000003-0003-0003-0003-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000003-0003-0003-0003-000000000003', 'WO_ATRIBUIDA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, NULL, NULL, '{"assignedTo":"bbbb5555-5555-5555-5555-555555555555"}'::jsonb, now() - interval '10 days' + interval '3 minutes'),
  ('e0000003-0003-0003-0003-000000000003', '11111111-1111-1111-1111-111111111111', 'a0000003-0003-0003-0003-000000000003', 'VISITA_TECNICA_INICIADA', 'USER', 'bbbb5555-5555-5555-5555-555555555555', '{"id":"bbbb5555-5555-5555-5555-555555555555","email":"service@gcdr.io","name":"Integration Service"}'::jsonb, NULL, NULL, '{}'::jsonb, now() - interval '8 days'),
  ('e0000003-0003-0003-0003-000000000004', '11111111-1111-1111-1111-111111111111', 'a0000003-0003-0003-0003-000000000003', 'VISITA_TECNICA_FINALIZADA', 'USER', 'bbbb5555-5555-5555-5555-555555555555', '{"id":"bbbb5555-5555-5555-5555-555555555555","email":"service@gcdr.io","name":"Integration Service"}'::jsonb, NULL, NULL, '{"note":"Visita concluída, sem pendências."}'::jsonb, now() - interval '7 days')
ON CONFLICT (id) DO NOTHING;

-- ── Annotations on WO A + their timeline markers ────────────────────────────
INSERT INTO annotations (id, tenant_id, customer_id, entity_type, entity_id, text, type, importance, status, created_by, created_at, updated_at)
VALUES
  ('b0000001-0001-0001-0001-000000000001', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777', 'work_order', 'a0000001-0001-0001-0001-000000000001',
   'Quadro elétrico com sinais de aquecimento — verificar conexões.', 'pending', 4, 'created',
   '{"id":"bbbb5555-5555-5555-5555-555555555555","email":"service@gcdr.io","name":"Integration Service"}'::jsonb, now() - interval '3 hours' + interval '5 minutes', now() - interval '3 hours' + interval '5 minutes'),
  ('b0000001-0001-0001-0001-000000000002', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777', 'work_order', 'a0000001-0001-0001-0001-000000000001',
   'Cliente solicitou relatório fotográfico ao final.', 'observation', 2, 'created',
   '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, now() - interval '2 hours', now() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO annotation_events (id, tenant_id, annotation_id, action, actor, created_at)
VALUES
  ('c0000001-0001-0001-0001-000000000001', '11111111-1111-1111-1111-111111111111', 'b0000001-0001-0001-0001-000000000001', 'created', '{"id":"bbbb5555-5555-5555-5555-555555555555","email":"service@gcdr.io","name":"Integration Service"}'::jsonb, now() - interval '3 hours' + interval '5 minutes'),
  ('c0000001-0001-0001-0001-000000000002', '11111111-1111-1111-1111-111111111111', 'b0000001-0001-0001-0001-000000000002', 'created', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, now() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;

-- Mirror the annotations onto the WO timeline (OBSERVACAO_INSERIDA markers).
INSERT INTO work_orders_events (id, tenant_id, work_order_id, event_type, actor_type, actor_user_id, actor, payload, created_at)
VALUES
  ('e0000001-0001-0001-0001-000000000006', '11111111-1111-1111-1111-111111111111', 'a0000001-0001-0001-0001-000000000001', 'OBSERVACAO_INSERIDA', 'USER', 'bbbb5555-5555-5555-5555-555555555555', '{"id":"bbbb5555-5555-5555-5555-555555555555","email":"service@gcdr.io","name":"Integration Service"}'::jsonb, '{"annotationId":"b0000001-0001-0001-0001-000000000001"}'::jsonb, now() - interval '3 hours' + interval '5 minutes'),
  ('e0000001-0001-0001-0001-000000000007', '11111111-1111-1111-1111-111111111111', 'a0000001-0001-0001-0001-000000000001', 'OBSERVACAO_INSERIDA', 'USER', 'bbbb1111-1111-1111-1111-111111111111', '{"id":"bbbb1111-1111-1111-1111-111111111111","email":"admin@gcdr.io","name":"Admin"}'::jsonb, '{"annotationId":"b0000001-0001-0001-0001-000000000002"}'::jsonb, now() - interval '2 hours')
ON CONFLICT (id) DO NOTHING;
