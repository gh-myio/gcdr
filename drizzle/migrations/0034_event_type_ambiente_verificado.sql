-- Migration 0034: new structural event type AMBIENTE_VERIFICADO
--
-- Field teams record environment verification as a timeline marker, next to
-- AMBIENTE_CRIADO (sort_order 82) — this slots in right after it.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction and
-- rejects explicit transaction-control statements.
--
-- Companion: docs/RFC-0037-Work-Orders-Event-Model.md

INSERT INTO "work_orders_event_types"
  ("code", "category", "label", "is_terminal", "sort_order", "active")
VALUES
  ('AMBIENTE_VERIFICADO', 'ESTRUTURA', 'Ambiente verificado', false, 86, true)
ON CONFLICT ("code") DO NOTHING;
