-- Migration 0044: CHAMADO_IMPORTADO event type (RFC-0044 Phase 4)
--
-- Marker event written by the Freshdesk importer for provenance. The import
-- path sets status directly (preserving Freshdesk timestamps) and bypasses the
-- lifecycle engine for historical data, so this is a non-status marker.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

INSERT INTO "work_orders_event_types" ("code", "category", "label", "is_terminal", "sort_order") VALUES
  ('CHAMADO_IMPORTADO', 'CHAMADO', 'Chamado importado (Freshdesk)', false, 89)
ON CONFLICT ("code") DO NOTHING;
