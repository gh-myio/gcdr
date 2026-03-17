-- Migration 0018: group_channels table + escalation_delay_ms on group_dispatch_configs
-- Run date: pending

-- 1. New table: group_channels
--    Stores per-group channel routing targets (chat_id, email, webhook URL, etc.)
--    Credentials stay in customer_channels; this table holds only the destination.
CREATE TABLE IF NOT EXISTS "group_channels" (
  "id"          uuid        NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   uuid        NOT NULL,
  "group_id"    uuid        NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "channel"     varchar(50) NOT NULL,
  -- EMAIL    → email address or alias (e.g. "ops@company.com")
  -- TELEGRAM → Telegram chat_id (e.g. "-100123456789")
  -- WHATSAPP → phone number (e.g. "+5531988880000")
  -- WEBHOOK  → URL (e.g. "https://hooks.company.com/gcdr")
  -- SLACK    → channel name (e.g. "#alertas")
  -- SMS      → phone number
  "active"      boolean     NOT NULL DEFAULT true,
  "target"      text        NOT NULL,
  "config"      jsonb       NOT NULL DEFAULT '{}',
  -- optional extra config (e.g. webhook method/headers)
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "group_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "group_channels_unique"
  ON "group_channels" ("tenant_id", "group_id", "channel");

CREATE INDEX IF NOT EXISTS "group_channels_tenant_group_idx"
  ON "group_channels" ("tenant_id", "group_id");

-- 2. Add escalation_delay_ms to group_dispatch_configs
ALTER TABLE "group_dispatch_configs"
  ADD COLUMN IF NOT EXISTS "escalation_delay_ms" integer NOT NULL DEFAULT 0;
