-- Migration 0057: RFC-0051 — Work Order Groups ("Grupo de OS") — phase G1
--
-- 1) Generic structural parent edge: any OS can have child OS ("filhas").
--    Orthogonal to ticket_id (RFC-0044 chamado membership) — both coexist.
-- 2) New WO type GRUPO: a pure container/aggregate OS.
-- 3) Marker event types for the link history (mirrors the CHAMADO_OS_* pair).
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "parent_id" uuid REFERENCES "work_orders"("id");

CREATE INDEX IF NOT EXISTS "work_orders_parent_idx"
  ON "work_orders" ("tenant_id", "parent_id")
  WHERE "parent_id" IS NOT NULL;

ALTER TABLE "work_orders" DROP CONSTRAINT IF EXISTS "work_orders_type_check";
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_type_check"
  CHECK ("type" IN ('INSTALACAO','MANUTENCAO','VISITA_TECNICA','CHAMADO','GRUPO'));

INSERT INTO "work_orders_event_types"
  ("code", "category", "label", "is_terminal", "sort_order", "active")
VALUES
  ('OS_FILHA_VINCULADA',    'ESTRUTURA', 'OS filha vinculada',    false, 89, true),
  ('OS_FILHA_DESVINCULADA', 'ESTRUTURA', 'OS filha desvinculada', false, 90, true)
ON CONFLICT ("code") DO NOTHING;
