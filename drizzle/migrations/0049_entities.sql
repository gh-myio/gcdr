-- Migration 0049: RFC-0047 — Generic Entity Registry (typed key/value forest)
--
-- Two tables:
--   * entity_types — governed type registry (GROUP/PROFILE/EQUIPMENT…) +
--                    allowed_parent_types; seed-driven, admin-extended.
--   * entities     — the typed key/value forest. customer_id NULL = system
--                    default (inherited by all customers); set = a customer
--                    override (a clone a MYIO operator edits). is_system marks
--                    the protected, never-deletable system rows.
--
-- Companion docs:
--   docs/rfcs/RFC-0047-Generic-Entity-Registry.md  (narrative + rules)
--   docs/rfcs/RFC-0047-Entity-schema.md            (this DDL + Drizzle snippet)
--   docs/rfcs/RFC-0047-Entity-API.md               (wire contract)
--
-- The is_system protection trigger lives in 0050_entities_triggers.sql.
--
-- No BEGIN/COMMIT: the custom runner wraps each file in its own transaction.

-- =============================================================================
-- 1) entity_types — governed type registry (seed-driven; admins add rows).
--    PK is (tenant_id, entity_type): types are tenant-scoped.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "entity_types" (
  "entity_type"          text        NOT NULL,
  "tenant_id"            uuid        NOT NULL,
  "label"                text        NOT NULL,
  "description"          text,
  "allowed_parent_types" text[]      NOT NULL DEFAULT '{}'::text[],   -- '{}' = root-only
  "is_active"            boolean     NOT NULL DEFAULT true,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "entity_types_pk" PRIMARY KEY ("tenant_id", "entity_type")
);

-- =============================================================================
-- 2) entities — the typed key/value forest.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "entities" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        uuid        NOT NULL,
  "customer_id"      uuid,                                            -- NULL = system default; set = customer override
  "entity_type"      text        NOT NULL,
  "entity_key"       text        NOT NULL,
  "entity_value"     text,
  "parent_entity_id" uuid        REFERENCES "entities"("id") ON DELETE RESTRICT,
  "sort_order"       integer     NOT NULL DEFAULT 0,                  -- deterministic sibling order; system-locked on is_system rows
  "clone_scope_key"  text        NOT NULL DEFAULT '*',                -- v1 always '*'; reserves per-root-tree override
  "is_system"        boolean     NOT NULL DEFAULT false,
  "is_active"        boolean     NOT NULL DEFAULT true,
  "is_deleted"       boolean     NOT NULL DEFAULT false,
  "metadata"         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "created_by"       uuid        NOT NULL,
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_by"       uuid        NOT NULL,
  "version"          integer     NOT NULL DEFAULT 1,
  CONSTRAINT "entities_type_fk"
    FOREIGN KEY ("tenant_id", "entity_type")
    REFERENCES "entity_types" ("tenant_id", "entity_type"),
  -- a system row is global (no customer); a customer row is never system
  CONSTRAINT "entities_system_scope"
    CHECK ("is_system" = false OR "customer_id" IS NULL),
  CONSTRAINT "entities_no_self_parent"
    CHECK ("parent_entity_id" IS NULL OR "parent_entity_id" <> "id")
);

-- =============================================================================
-- 3) Uniqueness — separate system vs customer namespaces; soft-deleted rows
--    excluded so a key frees on delete and re-clone works. COALESCE folds the
--    nullable parent (NULLs are otherwise distinct in a UNIQUE index).
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "entities_system_uq" ON "entities"
  ("tenant_id", COALESCE("parent_entity_id", '00000000-0000-0000-0000-000000000000'::uuid), "entity_type", "entity_key")
  WHERE "customer_id" IS NULL AND "is_deleted" = false;

CREATE UNIQUE INDEX IF NOT EXISTS "entities_customer_uq" ON "entities"
  ("tenant_id", "customer_id", COALESCE("parent_entity_id", '00000000-0000-0000-0000-000000000000'::uuid), "entity_type", "entity_key")
  WHERE "customer_id" IS NOT NULL AND "is_deleted" = false;

-- =============================================================================
-- 4) B-tree indexes (all partial on is_deleted = false). The parent index
--    carries sort_order for deterministic sibling traversal.
-- =============================================================================

CREATE INDEX IF NOT EXISTS "entities_tenant_type_idx"   ON "entities" ("tenant_id", "entity_type")  WHERE "is_deleted" = false;
CREATE INDEX IF NOT EXISTS "entities_tenant_key_idx"    ON "entities" ("tenant_id", "entity_key")   WHERE "is_deleted" = false;
CREATE INDEX IF NOT EXISTS "entities_tenant_parent_idx" ON "entities" ("tenant_id", "parent_entity_id", "sort_order") WHERE "is_deleted" = false;
CREATE INDEX IF NOT EXISTS "entities_customer_idx"      ON "entities" ("tenant_id", "customer_id")  WHERE "is_deleted" = false;
-- GIN on metadata deferred (tiny volume); add when a containment filter gets hot:
-- CREATE INDEX entities_metadata_gin ON entities USING gin (metadata jsonb_path_ops);
