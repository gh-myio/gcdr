-- =============================================================================
-- Seed 30 — CHAMADO lifecycle rules (RFC-0044, default flow)
-- =============================================================================
-- Materializes the default per-tenant flow for the CHAMADO work-order type on
-- the default tenant, so the data-driven Rules Engine (RFC-0041) drives ticket
-- status. Activates in Phase 2 (when LIFECYCLE_CATEGORIES includes CHAMADO);
-- harmless before that. Idempotent: clears the tenant's CHAMADO rows first.
-- FK-safe: each node is inserted only when its event_type exists in the catalog.
-- =============================================================================

DO $$
DECLARE
  v_tenant uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  DELETE FROM work_orders_lifecycle_rules
   WHERE tenant_id = v_tenant AND wo_type = 'CHAMADO';

  -- CHAMADO_ABERTO (entry) -> ABERTO
  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, is_entry, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_ABERTO',
    ARRAY[]::text[], 'NONE',
    ARRAY['CHAMADO_PENDENTE','CHAMADO_AGUARDANDO_SOLICITANTE','CHAMADO_RESOLVIDO','CHAMADO_CANCELADO','CHAMADO_OS_VINCULADA','CHAMADO_OS_DESVINCULADA'],
    'ABERTO', true, 10
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_ABERTO');

  -- CHAMADO_PENDENTE -> PENDENTE
  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_PENDENTE',
    ARRAY['CHAMADO_ABERTO','CHAMADO_REABERTO','CHAMADO_AGUARDANDO_SOLICITANTE'], 'ANY',
    ARRAY['CHAMADO_AGUARDANDO_SOLICITANTE','CHAMADO_RESOLVIDO','CHAMADO_CANCELADO'],
    'PENDENTE', 20
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_PENDENTE');

  -- CHAMADO_AGUARDANDO_SOLICITANTE -> AGUARDANDO
  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_AGUARDANDO_SOLICITANTE',
    ARRAY['CHAMADO_ABERTO','CHAMADO_PENDENTE','CHAMADO_REABERTO'], 'ANY',
    ARRAY['CHAMADO_PENDENTE','CHAMADO_RESOLVIDO','CHAMADO_CANCELADO'],
    'AGUARDANDO', 30
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_AGUARDANDO_SOLICITANTE');

  -- CHAMADO_RESOLVIDO -> RESOLVIDO
  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_RESOLVIDO',
    ARRAY['CHAMADO_ABERTO','CHAMADO_PENDENTE','CHAMADO_AGUARDANDO_SOLICITANTE','CHAMADO_REABERTO'], 'ANY',
    ARRAY['CHAMADO_FECHADO','CHAMADO_REABERTO'],
    'RESOLVIDO', 40
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_RESOLVIDO');

  -- CHAMADO_REABERTO -> ABERTO
  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_REABERTO',
    ARRAY['CHAMADO_RESOLVIDO'], 'ANY',
    ARRAY['CHAMADO_PENDENTE','CHAMADO_AGUARDANDO_SOLICITANTE','CHAMADO_RESOLVIDO','CHAMADO_CANCELADO'],
    'ABERTO', 50
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_REABERTO');

  -- CHAMADO_FECHADO (terminal) -> FECHADO
  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, is_terminal, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_FECHADO',
    ARRAY['CHAMADO_RESOLVIDO'], 'ANY', ARRAY[]::text[],
    'FECHADO', true, 60
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_FECHADO');

  -- CHAMADO_CANCELADO (terminal, allowed anytime) -> CANCELADO
  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, is_terminal, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_CANCELADO',
    ARRAY[]::text[], 'NONE', ARRAY[]::text[],
    'CANCELADO', true, 70
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_CANCELADO');

  -- Link markers (no status change) — always allowed while non-terminal.
  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_OS_VINCULADA',
    ARRAY['CHAMADO_ABERTO'], 'ANY', ARRAY[]::text[], NULL, 80
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_OS_VINCULADA');

  INSERT INTO work_orders_lifecycle_rules
    (tenant_id, wo_type, event_type, predecessors, predecessor_rule, activates, projects_status, sort_order)
  SELECT v_tenant, 'CHAMADO', 'CHAMADO_OS_DESVINCULADA',
    ARRAY['CHAMADO_OS_VINCULADA'], 'ANY', ARRAY[]::text[], NULL, 81
  WHERE EXISTS (SELECT 1 FROM work_orders_event_types WHERE code = 'CHAMADO_OS_DESVINCULADA');
END $$;
