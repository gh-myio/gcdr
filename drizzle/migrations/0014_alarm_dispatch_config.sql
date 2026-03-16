-- RFC-0024: Alarm Dispatch Configuration
-- Two-level notification dispatch: customer channels (credentials + kill switch) + group dispatch matrix

DO $$ BEGIN
  CREATE TYPE "alarm_action" AS ENUM ('OPEN', 'ACK', 'ESCALATE', 'SNOOZE', 'CLOSE', 'STATE_HISTORY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Customer-level channel registry (credentials + global active toggle)
CREATE TABLE IF NOT EXISTS "customer_channels" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"   uuid NOT NULL,
  "customer_id" uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  "channel"     varchar(50) NOT NULL,
  -- EMAIL_RELAY | TELEGRAM | WHATSAPP | WEBHOOK | SMS | SLACK | TEAMS | CUSTOM
  "active"      boolean NOT NULL DEFAULT true,
  "config"      jsonb NOT NULL DEFAULT '{}',
  -- EMAIL_RELAY:  { host, port, secure, user, from, displayName }
  -- TELEGRAM:     { botToken, defaultChatId }
  -- WHATSAPP:     { apiUrl, apiToken, fromNumber }
  -- WEBHOOK:      { url, method, headers, secret }
  -- SMS:          { provider, apiKey, fromNumber }
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "created_by"  uuid,
  UNIQUE ("tenant_id", "customer_id", "channel")
);

-- Group-level dispatch matrix (channel × action × active)
CREATE TABLE IF NOT EXISTS "group_dispatch_configs" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"  uuid NOT NULL,
  "group_id"   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  "channel"    varchar(50) NOT NULL,
  "action"     "alarm_action" NOT NULL,
  "active"     boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "group_id", "channel", "action")
);

CREATE INDEX IF NOT EXISTS "customer_channels_tenant_customer_idx"    ON "customer_channels"      ("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "customer_channels_tenant_active_idx"      ON "customer_channels"      ("tenant_id", "active");
CREATE INDEX IF NOT EXISTS "group_dispatch_configs_tenant_group_idx"  ON "group_dispatch_configs" ("tenant_id", "group_id");
