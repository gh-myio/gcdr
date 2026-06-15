-- Migration 0042: assistant_conversations (RFC-0043)
--
-- Per-user, persisted GCDR Copiloto chat history. Each row is one conversation
-- (a list of turns stored as JSONB). A conversation is private to its owner
-- unless "shared" = true, in which case other users in the same tenant can read
-- it (read-only; only the owner can edit/delete). The transient "ask" endpoint
-- stays stateless; this table is opt-in persistence the UI writes to.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

CREATE TABLE IF NOT EXISTS "assistant_conversations" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"  uuid NOT NULL,
  "user_id"    uuid NOT NULL,
  "title"      varchar(200) NOT NULL DEFAULT 'Conversa',
  "messages"   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "shared"     boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Own conversations, newest first.
CREATE INDEX IF NOT EXISTS "assistant_conversations_owner_idx"
  ON "assistant_conversations" ("tenant_id", "user_id", "updated_at" DESC);

-- Tenant feed of shared conversations.
CREATE INDEX IF NOT EXISTS "assistant_conversations_shared_idx"
  ON "assistant_conversations" ("tenant_id", "shared", "updated_at" DESC);
