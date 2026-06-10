-- Migration 0032: rename event-type PRODUTO_CRIADO -> PRODUTO_INSTALADO
--
-- "Produto" is a physical product installed in the field, so the field-language
-- event is "instalado", not "criado". `work_orders_events.event_type` has a FK
-- to `work_orders_event_types.code`, so a plain UPDATE of the code is unsafe:
-- we INSERT the new code, repoint referencing events, then DROP the old code.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction and
-- rejects explicit transaction-control statements.
--
-- Companion: docs/RFC-0037-Work-Orders-Event-Model.md

-- 1) create the new code (clone of the old row, relabeled)
INSERT INTO "work_orders_event_types" ("code", "category", "label", "is_terminal", "sort_order", "active")
SELECT 'PRODUTO_INSTALADO', "category", 'Produto instalado', "is_terminal", "sort_order", "active"
  FROM "work_orders_event_types"
 WHERE "code" = 'PRODUTO_CRIADO'
ON CONFLICT ("code") DO NOTHING;

-- 2) repoint every event that referenced the old code
UPDATE "work_orders_events"
   SET "event_type" = 'PRODUTO_INSTALADO'
 WHERE "event_type" = 'PRODUTO_CRIADO';

-- 3) drop the old code (now unreferenced)
DELETE FROM "work_orders_event_types"
 WHERE "code" = 'PRODUTO_CRIADO';
