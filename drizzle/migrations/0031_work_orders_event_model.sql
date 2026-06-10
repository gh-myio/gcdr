-- Migration 0031: RFC-0037 — Work Orders Event Model (+ RFC-0036 generalized annotations)
--
-- Greenfield replacement of the QR-Checker-derived Work-Orders schema with an
-- event-log model, plus the (polymorphic) RFC-0036 annotation subsystem.
--
-- The 12 legacy wo_* tables hold no production data (the feature was never
-- activated), so they are DROPPED. wo_customer_settings is RENAMED (kept).
-- Then the 5 work-order tables + 5 annotation tables are created and the
-- event-type catalog is seeded.
--
-- No BEGIN/COMMIT here: postgres-js / the custom runner wraps each file in its
-- own transaction and rejects explicit transaction control statements.
--
-- Companions: docs/RFC-0037-Work-Orders-Event-Model.md
--             docs/RFC-0036-Device-Annotations-Migration.md

-- =============================================================================
-- 1) Drop the 12 legacy QR-Checker tables (CASCADE: drops their FKs/indexes too)
--    Children-first ordering is tidy but irrelevant with CASCADE.
-- =============================================================================

DROP TABLE IF EXISTS "wo_visita_product_images"  CASCADE;
DROP TABLE IF EXISTS "wo_visita_products"        CASCADE;
DROP TABLE IF EXISTS "wo_visita_ambiente_images" CASCADE;
DROP TABLE IF EXISTS "wo_visita_ambientes"       CASCADE;
DROP TABLE IF EXISTS "wo_visita_observations"    CASCADE;
DROP TABLE IF EXISTS "wo_visita_audit"           CASCADE;
DROP TABLE IF EXISTS "wo_visitas_tecnicas"       CASCADE;
DROP TABLE IF EXISTS "wo_maintenance_tasks"      CASCADE;
DROP TABLE IF EXISTS "wo_installation_audit"     CASCADE;
DROP TABLE IF EXISTS "wo_installation_images"    CASCADE;
DROP TABLE IF EXISTS "wo_installations"          CASCADE;
DROP TABLE IF EXISTS "wo_customer_observations"  CASCADE;

-- =============================================================================
-- 2) Rename wo_customer_settings -> work_orders_customer_settings (kept as-is)
-- =============================================================================

ALTER TABLE IF EXISTS "wo_customer_settings" RENAME TO "work_orders_customer_settings";
ALTER INDEX IF EXISTS "idx_wo_cust_settings_tenant" RENAME TO "idx_work_orders_cust_settings_tenant";

-- =============================================================================
-- 3) Work-order tables (RFC-0037 §Reference-level)
-- =============================================================================

-- 3.1) Work Order ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "work_orders" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid NOT NULL,
  "customer_id"   uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
  "root_asset_id" uuid REFERENCES "assets"("id"),
  "type"          text NOT NULL,
  "status"        text NOT NULL DEFAULT 'PLANEJADA',
  "code"          text,
  "assigned_to"   uuid REFERENCES "users"("id"),
  "scheduled_at"  timestamptz,
  "created_by"    uuid NOT NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  "deleted_at"    timestamptz,
  CONSTRAINT "work_orders_type_check"
    CHECK ("type" IN ('INSTALACAO','MANUTENCAO','VISITA_TECNICA'))
);
CREATE INDEX IF NOT EXISTS "work_orders_tenant_customer_idx" ON "work_orders" ("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "work_orders_tenant_status_idx"   ON "work_orders" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "work_orders_root_asset_idx"      ON "work_orders" ("root_asset_id");

-- 3.2) Device scope (junction) ----------------------------------------------
CREATE TABLE IF NOT EXISTS "work_orders_devices" (
  "work_order_id" uuid NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
  "device_id"     uuid NOT NULL REFERENCES "devices"("id")     ON DELETE RESTRICT,
  "added_by"      uuid NOT NULL,
  "added_at"      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("work_order_id", "device_id")
);
CREATE INDEX IF NOT EXISTS "work_orders_devices_device_idx" ON "work_orders_devices" ("device_id");

-- 3.3) Event types catalog (extensible) -------------------------------------
CREATE TABLE IF NOT EXISTS "work_orders_event_types" (
  "code"        text PRIMARY KEY,
  "category"    text NOT NULL,
  "label"       text NOT NULL,
  "is_terminal" boolean NOT NULL DEFAULT false,
  "sort_order"  integer NOT NULL DEFAULT 0,
  "active"      boolean NOT NULL DEFAULT true
);

-- 3.4) Events ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "work_orders_events" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"     uuid NOT NULL,
  "work_order_id" uuid NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
  "event_type"    text NOT NULL REFERENCES "work_orders_event_types"("code"),
  "actor_type"    text NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "actor"         jsonb,
  "asset_id"      uuid REFERENCES "assets"("id"),
  "device_id"     uuid REFERENCES "devices"("id"),
  "payload"       jsonb NOT NULL DEFAULT '{}',
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "work_orders_events_actor_type_check"
    CHECK ("actor_type" IN ('USER','SYSTEM','API_KEY'))
);
CREATE INDEX IF NOT EXISTS "work_orders_events_wo_chrono_idx" ON "work_orders_events" ("work_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "work_orders_events_type_idx"      ON "work_orders_events" ("tenant_id", "event_type");
CREATE INDEX IF NOT EXISTS "work_orders_events_device_idx"    ON "work_orders_events" ("device_id") WHERE "device_id" IS NOT NULL;

-- 3.5) Files / evidence ------------------------------------------------------
CREATE TABLE IF NOT EXISTS "work_order_files" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid NOT NULL,
  "work_order_id"       uuid NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
  "work_order_event_id" uuid REFERENCES "work_orders_events"("id") ON DELETE SET NULL,
  "file_asset_id"       uuid NOT NULL REFERENCES "file_assets"("id"),
  "image_order"         integer NOT NULL DEFAULT 0,
  "caption"             text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "work_order_files_wo_file_unique" UNIQUE ("work_order_id", "file_asset_id")
);
CREATE INDEX IF NOT EXISTS "work_order_files_wo_idx"    ON "work_order_files" ("work_order_id", "image_order");
CREATE INDEX IF NOT EXISTS "work_order_files_event_idx" ON "work_order_files" ("work_order_event_id");

-- =============================================================================
-- 4) Annotation subsystem (RFC-0036, GENERALIZED to polymorphic entity_type)
-- =============================================================================

-- 4.1) annotations (aggregate root) -----------------------------------------
CREATE TABLE IF NOT EXISTS "annotations" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"       uuid NOT NULL,
  "customer_id"     uuid NOT NULL REFERENCES "customers"("id"),
  "entity_type"     text NOT NULL,
  "entity_id"       uuid NOT NULL,
  "schema_version"  text NOT NULL DEFAULT '1.0.0',
  "text"            text NOT NULL,
  "type"            text NOT NULL DEFAULT 'observation',
  "importance"      smallint NOT NULL DEFAULT 3,
  "status"          text NOT NULL DEFAULT 'created',
  "finalized"        boolean NOT NULL DEFAULT false,
  "finalized_reason" text,
  "due_date"         timestamptz,
  "acknowledged"     boolean NOT NULL DEFAULT false,
  "acknowledged_by"  jsonb,
  "acknowledged_at"  timestamptz,
  "created_by"      jsonb NOT NULL,
  "updated_by"      jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  "deleted_at"      timestamptz,
  "version"         integer NOT NULL DEFAULT 1,
  "legacy_id"       uuid,
  CONSTRAINT "annotations_entity_type_check"
    CHECK ("entity_type" IN ('device','work_order','work_order_event')),
  CONSTRAINT "annotations_type_check"
    CHECK ("type" IN ('observation','pending','maintenance','activity')),
  CONSTRAINT "annotations_status_check"
    CHECK ("status" IN ('created','modified','archived')),
  CONSTRAINT "annotations_importance_check"
    CHECK ("importance" BETWEEN 1 AND 5),
  CONSTRAINT "annotations_finalized_reason_check"
    CHECK ("finalized_reason" IS NULL OR "finalized_reason" IN ('approved','rejected','archived')),
  CONSTRAINT "annotations_text_len_check"
    CHECK (char_length("text") <= 255)
);
CREATE INDEX IF NOT EXISTS "annotations_entity_idx"          ON "annotations" ("tenant_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "annotations_tenant_customer_idx" ON "annotations" ("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "annotations_tenant_status_idx"   ON "annotations" ("tenant_id", "status") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "annotations_tenant_type_idx"     ON "annotations" ("tenant_id", "type")   WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "annotations_tenant_legacy_id_unique"
  ON "annotations" ("tenant_id", "legacy_id") WHERE "legacy_id" IS NOT NULL;

-- 4.2) annotation_responses (comments + decisions) --------------------------
CREATE TABLE IF NOT EXISTS "annotation_responses" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid NOT NULL,
  "annotation_id"  uuid NOT NULL REFERENCES "annotations"("id") ON DELETE CASCADE,
  "type"           text NOT NULL,
  "text"           text,
  "created_by"     jsonb NOT NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "legacy_id"      uuid,
  CONSTRAINT "annotation_responses_type_check"
    CHECK ("type" IN ('approved','rejected','comment','archived')),
  CONSTRAINT "annotation_responses_text_required_check"
    CHECK ("type" = 'approved' OR ("text" IS NOT NULL AND char_length("text") > 0)),
  CONSTRAINT "annotation_responses_text_len_check"
    CHECK ("text" IS NULL OR char_length("text") <= 255)
);
CREATE INDEX IF NOT EXISTS "annotation_responses_annotation_idx" ON "annotation_responses" ("annotation_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "annotation_responses_tenant_legacy_id_unique"
  ON "annotation_responses" ("tenant_id", "legacy_id") WHERE "legacy_id" IS NOT NULL;

-- 4.3) annotation_events (append-only history) ------------------------------
CREATE TABLE IF NOT EXISTS "annotation_events" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL,
  "annotation_id"    uuid NOT NULL REFERENCES "annotations"("id") ON DELETE CASCADE,
  "response_id"      uuid REFERENCES "annotation_responses"("id") ON DELETE SET NULL,
  "action"           text NOT NULL,
  "previous_version" integer,
  "changes"          jsonb,
  "actor"            jsonb NOT NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "annotation_events_action_check"
    CHECK ("action" IN ('created','modified','archived','approved','rejected','commented','acknowledged'))
);
CREATE INDEX IF NOT EXISTS "annotation_events_annotation_idx" ON "annotation_events" ("annotation_id", "created_at");

-- 4.4) annotation_mentions (mention users or devices) -----------------------
CREATE TABLE IF NOT EXISTS "annotation_mentions" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           uuid NOT NULL,
  "annotation_id"       uuid NOT NULL REFERENCES "annotations"("id") ON DELETE CASCADE,
  "response_id"         uuid REFERENCES "annotation_responses"("id") ON DELETE CASCADE,
  "mention_type"        text NOT NULL,
  "mentioned_user_id"   uuid REFERENCES "users"("id"),
  "mentioned_device_id" uuid REFERENCES "devices"("id"),
  "actor"               jsonb NOT NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "annotation_mentions_type_check"
    CHECK ("mention_type" IN ('user','device')),
  CONSTRAINT "annotation_mentions_target_check" CHECK (
    ("mention_type" = 'user'   AND "mentioned_user_id"   IS NOT NULL AND "mentioned_device_id" IS NULL) OR
    ("mention_type" = 'device' AND "mentioned_device_id" IS NOT NULL AND "mentioned_user_id"   IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS "annotation_mentions_annotation_idx" ON "annotation_mentions" ("annotation_id");
CREATE INDEX IF NOT EXISTS "annotation_mentions_user_idx"       ON "annotation_mentions" ("tenant_id", "mentioned_user_id")   WHERE "mentioned_user_id"   IS NOT NULL;
CREATE INDEX IF NOT EXISTS "annotation_mentions_device_idx"     ON "annotation_mentions" ("tenant_id", "mentioned_device_id") WHERE "mentioned_device_id" IS NOT NULL;

-- 4.5) annotation_attachments (reuse file_assets) ---------------------------
CREATE TABLE IF NOT EXISTS "annotation_attachments" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid NOT NULL,
  "annotation_id"  uuid NOT NULL REFERENCES "annotations"("id") ON DELETE CASCADE,
  "response_id"    uuid REFERENCES "annotation_responses"("id") ON DELETE CASCADE,
  "file_asset_id"  uuid NOT NULL REFERENCES "file_assets"("id"),
  "created_by"     jsonb NOT NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "annotation_attachments_annotation_idx" ON "annotation_attachments" ("annotation_id");
CREATE INDEX IF NOT EXISTS "annotation_attachments_response_idx"   ON "annotation_attachments" ("response_id") WHERE "response_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "annotation_attachments_file_idx"       ON "annotation_attachments" ("file_asset_id");

-- =============================================================================
-- 5) Seed work_orders_event_types (RFC-0037 §Event-type catalog)
--    is_terminal=true for CANCELADA / FINALIZADA codes.
-- =============================================================================

INSERT INTO "work_orders_event_types" ("code", "category", "label", "is_terminal", "sort_order") VALUES
  ('VISITA_TECNICA_PLANEJADA',                 'VISITA_TECNICA', 'Visita planejada',                  false, 10),
  ('VISITA_TECNICA_INICIADA',                  'VISITA_TECNICA', 'Visita iniciada',                   false, 11),
  ('VISITA_TECNICA_INTERROMPIDA',              'VISITA_TECNICA', 'Visita interrompida',               false, 12),
  ('VISITA_TECNICA_REINICIADA',                'VISITA_TECNICA', 'Visita reiniciada',                 false, 13),
  ('VISITA_TECNICA_REAGENDADA',                'VISITA_TECNICA', 'Visita reagendada',                 false, 14),
  ('VISITA_TECNICA_AGUARDANDO_AGENDA_CLIENTE', 'VISITA_TECNICA', 'Aguardando agenda do cliente',      false, 15),
  ('VISITA_TECNICA_AGUARDANDO_AGENDA_TECNICO', 'VISITA_TECNICA', 'Aguardando agenda do tecnico',      false, 16),
  ('VISITA_TECNICA_AGUARDANDO_OUTROS_MOTIVOS', 'VISITA_TECNICA', 'Aguardando outros motivos',         false, 17),
  ('VISITA_TECNICA_CANCELADA',                 'VISITA_TECNICA', 'Visita cancelada',                  true,  18),
  ('VISITA_TECNICA_FINALIZADA',                'VISITA_TECNICA', 'Visita finalizada',                 true,  19),
  ('INSTALACAO_PLANEJADA',                     'INSTALACAO',     'Instalacao planejada',              false, 20),
  ('INSTALACAO_INICIADA',                      'INSTALACAO',     'Instalacao iniciada',               false, 21),
  ('INSTALACAO_EXECUTADA_PARCIAL',             'INSTALACAO',     'Instalacao executada parcialmente', false, 22),
  ('INSTALACAO_INTERROMPIDA',                  'INSTALACAO',     'Instalacao interrompida',           false, 23),
  ('INSTALACAO_REINICIADA',                    'INSTALACAO',     'Instalacao reiniciada',             false, 24),
  ('INSTALACAO_REAGENDADA',                    'INSTALACAO',     'Instalacao reagendada',             false, 25),
  ('INSTALACAO_AGUARDANDO_AGENDA_CLIENTE',     'INSTALACAO',     'Aguardando agenda do cliente',      false, 26),
  ('INSTALACAO_AGUARDANDO_AGENDA_TECNICO',     'INSTALACAO',     'Aguardando agenda do tecnico',      false, 27),
  ('INSTALACAO_AGUARDANDO_OUTROS_MOTIVOS',     'INSTALACAO',     'Aguardando outros motivos',         false, 28),
  ('INSTALACAO_CANCELADA',                     'INSTALACAO',     'Instalacao cancelada',              true,  29),
  ('INSTALACAO_FINALIZADA',                    'INSTALACAO',     'Instalacao finalizada',             true,  30),
  ('MANUTENCAO_PLANEJADA',                     'MANUTENCAO',     'Manutencao planejada',              false, 40),
  ('MANUTENCAO_INICIADA',                      'MANUTENCAO',     'Manutencao iniciada',               false, 41),
  ('MANUTENCAO_EXECUTADA_PARCIAL',             'MANUTENCAO',     'Manutencao executada parcialmente', false, 42),
  ('MANUTENCAO_INTERROMPIDA',                  'MANUTENCAO',     'Manutencao interrompida',           false, 43),
  ('MANUTENCAO_REINICIADA',                    'MANUTENCAO',     'Manutencao reiniciada',             false, 44),
  ('MANUTENCAO_REAGENDADA',                    'MANUTENCAO',     'Manutencao reagendada',             false, 45),
  ('MANUTENCAO_AGUARDANDO_AGENDA_CLIENTE',     'MANUTENCAO',     'Aguardando agenda do cliente',      false, 46),
  ('MANUTENCAO_AGUARDANDO_AGENDA_TECNICO',     'MANUTENCAO',     'Aguardando agenda do tecnico',      false, 47),
  ('MANUTENCAO_AGUARDANDO_OUTROS_MOTIVOS',     'MANUTENCAO',     'Aguardando outros motivos',         false, 48),
  ('MANUTENCAO_CANCELADA',                     'MANUTENCAO',     'Manutencao cancelada',              true,  49),
  ('MANUTENCAO_FINALIZADA',                    'MANUTENCAO',     'Manutencao finalizada',             true,  50),
  ('OBSERVACAO_INSERIDA',                      'OBSERVACAO',     'Observacao inserida',               false, 60),
  ('OBSERVACAO_EDITADA',                       'OBSERVACAO',     'Observacao editada',                false, 61),
  ('OBSERVACAO_DELETADA',                      'OBSERVACAO',     'Observacao deletada',               false, 62),
  ('OBSERVACAO_ARQUIVADA',                     'OBSERVACAO',     'Observacao arquivada',              false, 63),
  ('ANEXO_INSERIDO',                           'ANEXO',          'Anexo inserido',                    false, 70),
  ('ANEXO_EDITADO',                            'ANEXO',          'Anexo editado',                     false, 71),
  ('ANEXO_DELETADO',                           'ANEXO',          'Anexo deletado',                    false, 72),
  ('ANEXO_ARQUIVADO',                          'ANEXO',          'Anexo arquivado',                   false, 73),
  ('WO_CRIADA',                                'ESTRUTURA',      'Ordem de servico criada',           false, 80),
  ('WO_ATRIBUIDA',                             'ESTRUTURA',      'Ordem de servico atribuida',        false, 81),
  ('AMBIENTE_CRIADO',                          'ESTRUTURA',      'Ambiente criado',                   false, 82),
  ('PRODUTO_CRIADO',                           'ESTRUTURA',      'Produto criado',                    false, 83),
  ('DEVICE_MOVIDO',                            'ESTRUTURA',      'Device movido',                     false, 84),
  ('WO_REAJUSTADA',                            'ESTRUTURA',      'Ordem de servico reajustada',       false, 85)
ON CONFLICT ("code") DO NOTHING;
