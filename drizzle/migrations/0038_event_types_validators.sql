-- Migration 0038: validator event types (work-order validators + client validators)
--
-- Two new responsibility dimensions on a work order, both append-only on the
-- timeline (replay ATRIBUIDO/DESATRIBUIDO and DEFINIDO/REMOVIDO to derive the
-- current set), mirroring the WO_ATRIBUIDA/WO_DESATRIBUIDA technician model:
--
--   * Validators       — system users responsible for validating execution.
--                        payload: { validatorUserId }
--   * Client validators— client-side contacts (name/email/phone), NOT system
--                        users. payload: { contactId, name, email, phone }
--
-- Category ESTRUTURA → never affects the projected status. Slots right after
-- WO_DESATRIBUIDA (sort_order 82).
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction and
-- rejects explicit transaction-control statements.
--
-- Companion: docs/RFC-0037-Work-Orders-Event-Model.md

INSERT INTO "work_orders_event_types"
  ("code", "category", "label", "is_terminal", "sort_order", "active")
VALUES
  ('WO_VALIDADOR_ATRIBUIDO',        'ESTRUTURA', 'Validador atribuido',          false, 83, true),
  ('WO_VALIDADOR_DESATRIBUIDO',     'ESTRUTURA', 'Validador removido',           false, 84, true),
  ('WO_CLIENTE_VALIDADOR_DEFINIDO', 'ESTRUTURA', 'Validador do cliente definido', false, 85, true),
  ('WO_CLIENTE_VALIDADOR_REMOVIDO', 'ESTRUTURA', 'Validador do cliente removido', false, 86, true)
ON CONFLICT ("code") DO NOTHING;
