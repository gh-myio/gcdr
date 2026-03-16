-- RFC-0024 follow-up: per-channel notification contacts for users
-- Stores EMAIL / TELEGRAM / WHATSAPP / SMS / SLACK contacts per user
-- Used by the alarm orchestrator to resolve dispatch addresses at notification time

CREATE TABLE IF NOT EXISTS "user_contacts" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"   uuid        NOT NULL,
  "user_id"     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "channel"     varchar(50) NOT NULL,
  -- EMAIL | TELEGRAM | WHATSAPP | SMS | SLACK | TEAMS | CUSTOM
  "value"       varchar(500) NOT NULL,
  -- EMAIL:    email address
  -- TELEGRAM: @handle or chat_id
  -- WHATSAPP: +CC DDD NNNNNNNN
  -- SMS:      +CC DDD NNNNNNNN
  -- SLACK:    @username or member_id
  "label"       varchar(100),
  -- optional: "work", "personal", "on-call"
  "verified"    boolean     NOT NULL DEFAULT false,
  "active"      boolean     NOT NULL DEFAULT true,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "user_id", "channel", "value")
);

CREATE INDEX IF NOT EXISTS "user_contacts_tenant_user_idx"    ON "user_contacts" ("tenant_id", "user_id");
CREATE INDEX IF NOT EXISTS "user_contacts_tenant_channel_idx" ON "user_contacts" ("tenant_id", "channel");
