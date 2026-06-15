-- Migration 0040: work_orders_lifecycle_rules (RFC-0041, Phase 2)
--
-- Per-tenant, data-driven WO flow. Each row is a node governing one event-type
-- (within a wo_type, or wo_type NULL = all types): its predecessors + the rule
-- over them (NONE/ANY/ALL), the types it activates next, and the status it
-- projects. The Rules Engine reads this; when a tenant has no rows it falls back
-- to the built-in default flow, so this table is optional.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

CREATE TABLE IF NOT EXISTS "work_orders_lifecycle_rules" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid NOT NULL,
  "wo_type"          text,
  "event_type"       text NOT NULL REFERENCES "work_orders_event_types"("code"),
  "predecessors"     text[] NOT NULL DEFAULT '{}',
  "predecessor_rule" text   NOT NULL DEFAULT 'NONE',
  "activates"        text[] NOT NULL DEFAULT '{}',
  "projects_status"  text,
  "is_entry"         boolean NOT NULL DEFAULT false,
  "sort_order"       integer NOT NULL DEFAULT 0,
  "active"           boolean NOT NULL DEFAULT true,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "work_orders_lifecycle_rules_rule_check"
    CHECK ("predecessor_rule" IN ('NONE','ANY','ALL'))
);

-- wo_type is nullable (NULL = all types); COALESCE keeps the uniqueness intact.
CREATE UNIQUE INDEX IF NOT EXISTS "work_orders_lifecycle_rules_unique"
  ON "work_orders_lifecycle_rules" ("tenant_id", COALESCE("wo_type", ''), "event_type");

CREATE INDEX IF NOT EXISTS "work_orders_lifecycle_rules_tenant_idx"
  ON "work_orders_lifecycle_rules" ("tenant_id");
