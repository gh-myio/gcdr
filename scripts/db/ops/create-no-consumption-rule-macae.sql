-- ============================================================================
-- RFC-0055 — cria manualmente uma rule NO_CONSUMPTION para o Shopping Plaza
-- Macaé (prod). Rodar com psql no banco de prod.
--
-- IMPORTANTE (prod): o baseline de prod parou na migration 0063 — as 0064/0065
-- (enum + coluna + CHECK) podem ainda não ter sido aplicadas lá. Os passos 1-3
-- abaixo são exatamente essas migrations, idempotentes (IF NOT EXISTS); em um
-- banco já migrado eles são no-op. O ideal continua sendo rodar o runner
-- (npm run db:mig:up) — use os passos manuais só se optar pelo caminho na mão.
--
-- Obs: ALTER TYPE ... ADD VALUE não pode rodar dentro de transação junto com o
-- uso do novo valor. psql em autocommit (padrão, sem -1) executa cada statement
-- em transação própria — NÃO envolva este arquivo em BEGIN/COMMIT.
--
-- Semântica da rule (RFC-0055):
--   - internal_rule = true  -> plataforma-gerenciada; NÃO aparece em
--     /alarm-rules/bundle/simple; entregue APENAS em noConsumptionRules[] no
--     GET /customers/:id/alarm-rules/bundle/to-verify-service.
--   - no_consumption_config validado pelo CHECK valid_no_consumption_config.
-- ============================================================================

-- 1) enum (migration 0064)
ALTER TYPE "public"."rule_type" ADD VALUE IF NOT EXISTS 'NO_CONSUMPTION';

-- 2) coluna (migration 0064)
ALTER TABLE "rules" ADD COLUMN IF NOT EXISTS "no_consumption_config" jsonb;

-- 3) CHECK (migration 0065)
ALTER TABLE "rules" DROP CONSTRAINT IF EXISTS "valid_no_consumption_config";
ALTER TABLE "rules" ADD CONSTRAINT "valid_no_consumption_config"
  CHECK ("type" != 'NO_CONSUMPTION' OR "no_consumption_config" IS NOT NULL);

-- 4) a rule (idempotente por nome+customer; ajuste config conforme necessário)
INSERT INTO rules (
  tenant_id,
  customer_id,
  name,
  description,
  type,
  priority,
  scope_type,
  scope_entity_ids,
  no_consumption_config,
  notification_channels,
  tags,
  status,
  enabled,
  internal_rule
)
SELECT
  '11111111-1111-1111-1111-111111111111',            -- tenant default
  '8eccc220-f647-11f0-998e-25174baff087',            -- Shopping Plaza Macaé
  'Sem consumo — Shopping Plaza Macaé',
  'RFC-0055: alarme de ausência de consumo (slot horário sem amostras após a carência).',
  'NO_CONSUMPTION',
  'HIGH',
  'CUSTOMER',
  ARRAY['8eccc220-f647-11f0-998e-25174baff087']::uuid[],
  jsonb_build_object(
    'metric',              'energy_consumption',    -- ou 'water_flow'
    'windowMinutes',       60,                       -- fixo (v1)
    'minSamplesPerWindow', 1,
    'graceWindows',        1,                        -- nº de slots vazios de carência
    'timezone',            'America/Sao_Paulo',
    'activeHours',         NULL                      -- ou {"start":"06:00","end":"22:00"}
  ),
  '[]'::jsonb,
  '["rfc-0055","manual"]'::jsonb,
  'ACTIVE',
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM rules
  WHERE customer_id = '8eccc220-f647-11f0-998e-25174baff087'
    AND type = 'NO_CONSUMPTION'
    AND name = 'Sem consumo — Shopping Plaza Macaé'
);

-- 5) conferência
SELECT id, name, type, enabled, internal_rule, no_consumption_config
FROM rules
WHERE customer_id = '8eccc220-f647-11f0-998e-25174baff087'
  AND type = 'NO_CONSUMPTION';
