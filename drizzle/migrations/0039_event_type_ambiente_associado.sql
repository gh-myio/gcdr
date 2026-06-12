-- Migration 0039: new structural event type AMBIENTE_ASSOCIADO
--
-- When a work order is created against EXISTING environments (assets), the
-- timeline marker should read "Ambiente associado" — associating, not creating.
-- The frontend previously emitted AMBIENTE_CRIADO for this, which was wrong.
-- AMBIENTE_CRIADO (sort_order 82) stays for the genuine create case.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction and
-- rejects explicit transaction-control statements.
--
-- Companion: docs/RFC-0037-Work-Orders-Event-Model.md

INSERT INTO "work_orders_event_types"
  ("code", "category", "label", "is_terminal", "sort_order", "active")
VALUES
  ('AMBIENTE_ASSOCIADO', 'ESTRUTURA', 'Ambiente associado', false, 87, true)
ON CONFLICT ("code") DO NOTHING;
