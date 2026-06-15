-- =============================================================================
-- Seed 29 — Work Orders lifecycle rules (RFC-0041, Phase 2 defaults)
-- =============================================================================
-- Materializes the default per-tenant flow for the 3 WO types on the default
-- tenant, so the data-driven Rules Engine path is exercised and the flow can be
-- edited. Occurrence-based predecessors (a node is allowed when its predecessor
-- rule is satisfied by events that have happened); ANY = at least one present.
--
-- Idempotent: clears the tenant's rows first, then re-inserts. FK-safe: each
-- node is only inserted when its event_type exists in the catalog.
-- =============================================================================

DO $$
DECLARE
  v_tenant uuid := '11111111-1111-1111-1111-111111111111';
  v_types  text[] := ARRAY['INSTALACAO', 'MANUTENCAO', 'VISITA_TECNICA'];
  v_t text;

  -- helper sets of suffixes (reused across types)
  s_await text[] := ARRAY['AGUARDANDO_AGENDA_CLIENTE','AGUARDANDO_AGENDA_TECNICO','AGUARDANDO_OUTROS_MOTIVOS'];
  s_progress text[] := ARRAY['INICIADA','REINICIADA','EXECUTADA_PARCIAL'];
  v_aw text;
BEGIN
  DELETE FROM work_orders_lifecycle_rules WHERE tenant_id = v_tenant;

  FOREACH v_t IN ARRAY v_types LOOP
    -- PLANEJADA (entry)
    INSERT INTO work_orders_lifecycle_rules
      (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, is_entry, sort_order)
    SELECT v_tenant, v_t, v_t||'_PLANEJADA',
      ARRAY[]::text[], 'NONE',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['INICIADA','REAGENDADA','CANCELADA'] || s_await) s),
      'PLANEJADA', true, 10
    WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_PLANEJADA');

    -- INICIADA
    INSERT INTO work_orders_lifecycle_rules
      (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
    SELECT v_tenant, v_t, v_t||'_INICIADA',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['PLANEJADA','REAGENDADA'] || s_await) s), 'ANY',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['EXECUTADA_PARCIAL','INTERROMPIDA','FINALIZADA','CANCELADA']) s),
      'EM_ANDAMENTO', 20
    WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_INICIADA');

    -- REINICIADA
    INSERT INTO work_orders_lifecycle_rules
      (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
    SELECT v_tenant, v_t, v_t||'_REINICIADA',
      ARRAY[v_t||'_INTERROMPIDA'], 'ANY',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['EXECUTADA_PARCIAL','INTERROMPIDA','FINALIZADA','CANCELADA']) s),
      'EM_ANDAMENTO', 25
    WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_REINICIADA');

    -- EXECUTADA_PARCIAL
    INSERT INTO work_orders_lifecycle_rules
      (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
    SELECT v_tenant, v_t, v_t||'_EXECUTADA_PARCIAL',
      ARRAY[v_t||'_INICIADA', v_t||'_REINICIADA'], 'ANY',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['EXECUTADA_PARCIAL','INTERROMPIDA','FINALIZADA']) s),
      'EM_ANDAMENTO', 30
    WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_EXECUTADA_PARCIAL');

    -- INTERROMPIDA
    INSERT INTO work_orders_lifecycle_rules
      (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
    SELECT v_tenant, v_t, v_t||'_INTERROMPIDA',
      ARRAY(SELECT v_t||'_'||s FROM unnest(s_progress) s), 'ANY',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['REINICIADA','REAGENDADA','FINALIZADA','CANCELADA']) s),
      'INTERROMPIDA', 40
    WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_INTERROMPIDA');

    -- REAGENDADA
    INSERT INTO work_orders_lifecycle_rules
      (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
    SELECT v_tenant, v_t, v_t||'_REAGENDADA',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['PLANEJADA','INTERROMPIDA'] || s_progress || s_await) s), 'ANY',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['INICIADA','CANCELADA']) s),
      'REAGENDADA', 50
    WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_REAGENDADA');

    -- AGUARDANDO_* (3 nodes, same rule)
    FOREACH v_aw IN ARRAY s_await LOOP
      INSERT INTO work_orders_lifecycle_rules
        (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
      SELECT v_tenant, v_t, v_t||'_'||v_aw,
        ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['PLANEJADA','INTERROMPIDA','REAGENDADA'] || s_progress) s), 'ANY',
        ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['INICIADA','REAGENDADA','CANCELADA']) s),
        'AGUARDANDO', 60
      WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_'||v_aw);
    END LOOP;

    -- FINALIZADA (terminal)
    INSERT INTO work_orders_lifecycle_rules
      (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, is_terminal, sort_order)
    SELECT v_tenant, v_t, v_t||'_FINALIZADA',
      ARRAY(SELECT v_t||'_'||s FROM unnest(s_progress) s), 'ANY',
      ARRAY[]::text[], 'FINALIZADA', true, 70
    WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_FINALIZADA');

    -- CANCELADA (terminal)
    INSERT INTO work_orders_lifecycle_rules
      (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, is_terminal, sort_order)
    SELECT v_tenant, v_t, v_t||'_CANCELADA',
      ARRAY(SELECT v_t||'_'||s FROM unnest(ARRAY['PLANEJADA','INTERROMPIDA','REAGENDADA'] || s_progress || s_await) s), 'ANY',
      ARRAY[]::text[], 'CANCELADA', true, 80
    WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = v_t||'_CANCELADA');
  END LOOP;

  RAISE NOTICE 'Seed 29: lifecycle rules = %', (SELECT count(*) FROM work_orders_lifecycle_rules WHERE tenant_id = v_tenant);
END $$;
