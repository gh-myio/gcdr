-- Migration 0037: new structural event type WO_DESATRIBUIDA
--
-- Assignees are derived from the assignedTo column plus append-only
-- WO_ATRIBUIDA markers. Removing a technician needs a complementary marker so
-- the timeline stays append-only; the UI replays ATRIBUIDA/DESATRIBUIDA in
-- order to compute the current responsible team. Slots right after
-- WO_ATRIBUIDA (sort_order 81).
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction and
-- rejects explicit transaction-control statements.
--
-- Companion: docs/RFC-0037-Work-Orders-Event-Model.md

INSERT INTO "work_orders_event_types"
  ("code", "category", "label", "is_terminal", "sort_order", "active")
VALUES
  ('WO_DESATRIBUIDA', 'ESTRUTURA', 'Ordem de servico desatribuida', false, 82, true)
ON CONFLICT ("code") DO NOTHING;
