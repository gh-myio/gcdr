-- Migration 0043: Chamados as Work Order type CHAMADO (RFC-0044, Phase 1)
--
-- A chamado (support ticket) is modeled as a new work_order type that fans out
-- into N execution OS via work_orders.ticket_id (self-reference). This migration
-- is schema + catalog only: it widens the type CHECK, adds the ticket-specific
-- 1:1 meta table, the CC/watchers table, the parent edge, and seeds the CHAMADO
-- event types. Lifecycle rows are per-tenant (seeded separately); behavior
-- (LIFECYCLE_CATEGORIES, services, UI) lands in Phase 2.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

-- 1) Allow the new type ---------------------------------------------------------
ALTER TABLE "work_orders" DROP CONSTRAINT IF EXISTS "work_orders_type_check";
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_type_check"
  CHECK ("type" IN ('INSTALACAO','MANUTENCAO','VISITA_TECNICA','CHAMADO'));

-- 2) Parent edge: the CHAMADO an OS hangs on (managed, mutable) ------------------
ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "ticket_id" uuid REFERENCES "work_orders"("id");

CREATE INDEX IF NOT EXISTS "work_orders_ticket_idx"
  ON "work_orders" ("tenant_id", "ticket_id")
  WHERE "ticket_id" IS NOT NULL;

-- 3) Ticket-specific 1:1 extension (only for type = CHAMADO) ---------------------
CREATE TABLE IF NOT EXISTS "work_orders_ticket_meta" (
  "work_order_id"     uuid PRIMARY KEY REFERENCES "work_orders"("id") ON DELETE CASCADE,
  "tenant_id"         uuid NOT NULL,
  "subject"           varchar(255) NOT NULL,
  "priority"          text NOT NULL DEFAULT 'MEDIA',
  "reason"            text,
  "source"            text NOT NULL DEFAULT 'PAINEL',
  "requester_email"   varchar(255) NOT NULL,
  "requester_user_id" uuid REFERENCES "users"("id"),
  "requester_domain"  text,
  "external_id"       text,
  "first_response_at" timestamptz,
  "resolved_at"       timestamptz,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "work_orders_ticket_meta_priority_check"
    CHECK ("priority" IN ('BAIXA','MEDIA','ALTA','URGENTE')),
  CONSTRAINT "work_orders_ticket_meta_source_check"
    CHECK ("source" IN ('PAINEL','EMAIL','FRESHDESK','API'))
);

CREATE INDEX IF NOT EXISTS "work_orders_ticket_meta_requester_idx"
  ON "work_orders_ticket_meta" ("tenant_id", "requester_email");

CREATE INDEX IF NOT EXISTS "work_orders_ticket_meta_domain_idx"
  ON "work_orders_ticket_meta" ("tenant_id", "requester_domain");

CREATE INDEX IF NOT EXISTS "work_orders_ticket_meta_external_idx"
  ON "work_orders_ticket_meta" ("tenant_id", "external_id")
  WHERE "external_id" IS NOT NULL;

-- 4) CC / watchers --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "work_orders_watchers" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid NOT NULL,
  "work_order_id" uuid NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
  "email"         varchar(255) NOT NULL,
  "user_id"       uuid REFERENCES "users"("id"),
  "created_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "work_orders_watchers_unique"
  ON "work_orders_watchers" ("work_order_id", "email");

-- 5) Seed the CHAMADO event-type catalog (global) -------------------------------
INSERT INTO "work_orders_event_types" ("code", "category", "label", "is_terminal", "sort_order") VALUES
  ('CHAMADO_ABERTO',                 'CHAMADO', 'Chamado aberto',            false, 80),
  ('CHAMADO_PENDENTE',               'CHAMADO', 'Chamado pendente',          false, 81),
  ('CHAMADO_AGUARDANDO_SOLICITANTE', 'CHAMADO', 'Aguardando solicitante',    false, 82),
  ('CHAMADO_RESOLVIDO',              'CHAMADO', 'Chamado resolvido',         false, 83),
  ('CHAMADO_REABERTO',               'CHAMADO', 'Chamado reaberto',          false, 84),
  ('CHAMADO_OS_VINCULADA',           'CHAMADO', 'OS vinculada ao chamado',   false, 85),
  ('CHAMADO_OS_DESVINCULADA',        'CHAMADO', 'OS desvinculada do chamado',false, 86),
  ('CHAMADO_CANCELADO',              'CHAMADO', 'Chamado cancelado',         true,  87),
  ('CHAMADO_FECHADO',                'CHAMADO', 'Chamado fechado',           true,  88)
ON CONFLICT ("code") DO NOTHING;
