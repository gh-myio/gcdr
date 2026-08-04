-- =============================================================================
-- RFC-0055 (ED-1079) — Curated internal NO_CONSUMPTION rule for Moxuara.
-- =============================================================================
-- Detects devices with NO energy-consumption telemetry in a 1h window.
--
-- Marked is_internal_support_rule = true so it ships in the alarm bundle's
-- noConsumptionRules[] section (consumed by the Alarms Orchestrator) WITHOUT
-- appearing in the customer-facing rules UI. Scope = CUSTOMER, so it covers
-- every metering device under Moxuara (convention: scope_entity_ids = {customer}).
--
-- Idempotent: fixed rule id + ON CONFLICT DO UPDATE. Safe to re-run.
--
-- Run (local, Docker Desktop):
--   docker cp scripts/db/ops/rfc0055-seed-no-consumption-moxuara.sql \
--     gcdr-db-local:/tmp/seed.sql
--   docker exec gcdr-db-local psql -U postgres -d db_gcdr -f /tmp/seed.sql
-- =============================================================================

BEGIN;

-- Drop the earlier throwaway mock (superseded by the curated rule below).
DELETE FROM rules
 WHERE id = '9007a272-2f8c-4f33-82b7-3b9ecdf272c8';

INSERT INTO rules (
  id,
  tenant_id,
  customer_id,
  name,
  description,
  type,
  priority,
  scope_type,
  scope_entity_ids,
  no_consumption_config,
  status,
  enabled,
  is_internal_support_rule
) VALUES (
  '55c05500-0055-4055-8055-000000000001',
  '11111111-1111-1111-1111-111111111111',           -- tenant default
  '84e0370e-636a-4741-9874-504b5e0b3577',           -- Moxuara
  'Sem consumo (1h) - Moxuara',
  'RFC-0055: nenhum dado de consumo de energia recebido na janela de 1h.',
  'NO_CONSUMPTION',
  'MEDIUM',
  'CUSTOMER',
  ARRAY['84e0370e-636a-4741-9874-504b5e0b3577']::uuid[],
  '{"metric":"energy_consumption","windowMinutes":60,"minSamplesPerWindow":1,"graceWindows":1,"timezone":"America/Sao_Paulo","activeHours":null}'::jsonb,
  'ACTIVE',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  name                     = EXCLUDED.name,
  description              = EXCLUDED.description,
  type                     = EXCLUDED.type,
  priority                 = EXCLUDED.priority,
  scope_type               = EXCLUDED.scope_type,
  scope_entity_ids         = EXCLUDED.scope_entity_ids,
  no_consumption_config    = EXCLUDED.no_consumption_config,
  status                   = EXCLUDED.status,
  enabled                  = EXCLUDED.enabled,
  is_internal_support_rule = EXCLUDED.is_internal_support_rule,
  updated_at               = now();

COMMIT;

-- Verification
SELECT id, name, type, enabled, is_internal_support_rule, scope_type, scope_entity_ids
  FROM rules
 WHERE id = '55c05500-0055-4055-8055-000000000001';
