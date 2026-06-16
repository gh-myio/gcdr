-- Migration 0045: email_ingestion_log + CHAMADO_EMAIL_RECEBIDO event (RFC-0045 Phase 1)
--
-- email_ingestion_log gives inbound email -> chamado two things:
--   1) idempotency  — UNIQUE (tenant_id, message_id) so a redelivered message
--      (provider retry / poll overlap) is processed once;
--   2) thread anchor — each stored Message-ID maps to the chamado it landed on,
--      so a reply (In-Reply-To / References) appends instead of duplicating.
--
-- CHAMADO_EMAIL_RECEBIDO is a non-status marker that places the email body on the
-- chamado timeline (both on open and on every reply), like CHAMADO_OS_VINCULADA.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

CREATE TABLE IF NOT EXISTS "email_ingestion_log" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid NOT NULL,
  "message_id"    text NOT NULL,
  "work_order_id" uuid REFERENCES "work_orders"("id") ON DELETE SET NULL,
  "direction"     text NOT NULL DEFAULT 'inbound'
                    CHECK ("direction" IN ('inbound','outbound')),
  "from_address"  varchar(320),
  "to_address"    varchar(320),
  "subject"       varchar(512),
  "in_reply_to"   text,
  "status"        text NOT NULL
                    CHECK ("status" IN ('created','appended','skipped','error')),
  "error"         text,
  "processed_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_ingestion_log_tenant_message_unique"
  ON "email_ingestion_log" ("tenant_id", "message_id");

CREATE INDEX IF NOT EXISTS "email_ingestion_log_work_order_idx"
  ON "email_ingestion_log" ("tenant_id", "work_order_id");

INSERT INTO "work_orders_event_types" ("code", "category", "label", "is_terminal", "sort_order") VALUES
  ('CHAMADO_EMAIL_RECEBIDO', 'CHAMADO', 'E-mail recebido', false, 90)
ON CONFLICT ("code") DO NOTHING;
