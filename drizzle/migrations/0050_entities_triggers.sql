-- Migration 0050: RFC-0047 — is_system protection trigger for `entities`.
--
-- is_system = true rows are protected: a non-admin DELETE (soft or hard),
-- deactivate, or any mutation must fail. This BEFORE UPDATE OR DELETE trigger
-- is the *source of truth* (the service layer translates the raised exception
-- into a friendly 409 SYSTEM_PROTECTED). Admin-only paths bypass via a session
-- GUC (`app.is_admin = 'on'`) the service sets inside its admin transactions.
--
-- Idiom mirrors 0020_wiki_module.sql:
--   CREATE OR REPLACE FUNCTION  →  DROP TRIGGER IF EXISTS  →  CREATE TRIGGER.
--
-- Companion: drizzle/migrations/0049_entities.sql ·
--            docs/rfcs/RFC-0047-Entity-schema.md
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

CREATE OR REPLACE FUNCTION entities_protect_system() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'SYSTEM_PROTECTED' USING ERRCODE = 'raise_exception';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: block soft-delete / deactivate / mutation of a system row.
  -- (Admin-only edits bypass via the session GUC set by the service.)
  IF OLD.is_system AND current_setting('app.is_admin', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'SYSTEM_PROTECTED' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS entities_protect_system_trg ON entities;

CREATE TRIGGER entities_protect_system_trg
  BEFORE UPDATE OR DELETE ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_protect_system();
