-- Migration 0020: RFC-0030 — MYIO Wiki (Knowledge Base Module) — Phase 1
--
-- Introduces:
--   * wiki_pages             — page metadata + current_revision pointer + visibility
--   * wiki_page_revisions    — immutable revision history (Markdown source + rendered HTML)
--   * wiki_namespaces        — per-tenant top-level folders
--
-- Companion RFC: docs/RFC-0030-MYIO-Wiki-Knowledge-Base.md
-- Companion infra: docs/RFC-0030-S3-Bucket-Setup.md (for later phases)

-- =============================================================================
-- Namespaces
-- =============================================================================

CREATE TABLE IF NOT EXISTS "wiki_namespaces" (
  "tenant_id"        uuid        NOT NULL,
  "name"             text        NOT NULL,
  "description"      text,
  "review_required"  boolean     NOT NULL DEFAULT false,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "wiki_namespaces_pk" PRIMARY KEY ("tenant_id", "name"),
  CONSTRAINT "wiki_namespaces_name_shape"
    CHECK ("name" ~ '^[A-Za-z][A-Za-z0-9_-]{0,31}$')
);

-- =============================================================================
-- Pages
-- =============================================================================

CREATE TABLE IF NOT EXISTS "wiki_pages" (
  "id"                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"            uuid         NOT NULL,
  "namespace"            text         NOT NULL,
  "slug"                 text         NOT NULL,
  "title"                text         NOT NULL,
  "status"               text         NOT NULL DEFAULT 'DRAFT',
  "current_revision_id"  uuid,
  "tags"                 text[]       NOT NULL DEFAULT '{}'::text[],
  "visibility"           text[]       NOT NULL DEFAULT ARRAY['TENANT_PRIVATE']::text[],
  "frontmatter"          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  "created_by"           uuid         NOT NULL,
  "created_at"           timestamptz  NOT NULL DEFAULT now(),
  "updated_at"           timestamptz  NOT NULL DEFAULT now(),
  "deleted_at"           timestamptz,
  "version"              integer      NOT NULL DEFAULT 1,
  CONSTRAINT "wiki_pages_status_check"
    CHECK ("status" IN ('DRAFT','REVIEW','PUBLISHED','ARCHIVED')),
  CONSTRAINT "wiki_pages_visibility_nonempty"
    CHECK (array_length("visibility", 1) >= 1),
  CONSTRAINT "wiki_pages_visibility_tags_valid"
    CHECK ("visibility" <@ ARRAY[
      'PUBLIC',
      'MYIO_INTERNAL',
      'PARTNERS',
      'HOLDING_CUSTOMERS',
      'NON_HOLDING_CUSTOMERS',
      'TENANT_PRIVATE'
    ]::text[]),
  CONSTRAINT "wiki_pages_slug_shape"
    CHECK ("slug" ~ '^[a-z0-9][a-z0-9/_-]{0,127}$'),
  CONSTRAINT "wiki_pages_tenant_ns_slug_unique"
    UNIQUE ("tenant_id", "namespace", "slug")
);

CREATE INDEX IF NOT EXISTS "idx_wiki_pages_tenant_ns"
  ON "wiki_pages" ("tenant_id", "namespace");

CREATE INDEX IF NOT EXISTS "idx_wiki_pages_tenant_status"
  ON "wiki_pages" ("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "idx_wiki_pages_tags"
  ON "wiki_pages" USING gin ("tags");

CREATE INDEX IF NOT EXISTS "idx_wiki_pages_visibility"
  ON "wiki_pages" USING gin ("visibility");

CREATE INDEX IF NOT EXISTS "idx_wiki_pages_frontmatter"
  ON "wiki_pages" USING gin ("frontmatter");

-- Optional: help `WHERE deleted_at IS NULL` on list endpoints.
CREATE INDEX IF NOT EXISTS "idx_wiki_pages_tenant_live"
  ON "wiki_pages" ("tenant_id")
  WHERE "deleted_at" IS NULL;

-- =============================================================================
-- Revisions (immutable)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "wiki_page_revisions" (
  "id"               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "page_id"          uuid         NOT NULL REFERENCES "wiki_pages"("id") ON DELETE CASCADE,
  "revision_number"  integer      NOT NULL,
  "title"            text         NOT NULL,
  "body"             text         NOT NULL,
  "body_html"        text         NOT NULL,
  "frontmatter"      jsonb        NOT NULL DEFAULT '{}'::jsonb,
  "change_note"      text,
  "author_id"        uuid         NOT NULL,
  "created_at"       timestamptz  NOT NULL DEFAULT now(),
  "search_tsv"       tsvector,
  CONSTRAINT "wiki_page_revisions_page_rev_unique"
    UNIQUE ("page_id", "revision_number"),
  CONSTRAINT "wiki_page_revisions_revnum_positive"
    CHECK ("revision_number" >= 1)
);

CREATE INDEX IF NOT EXISTS "idx_wiki_revisions_page_rev"
  ON "wiki_page_revisions" ("page_id", "revision_number" DESC);

CREATE INDEX IF NOT EXISTS "idx_wiki_revisions_search_tsv"
  ON "wiki_page_revisions" USING gin ("search_tsv");

-- =============================================================================
-- Back-reference: wiki_pages.current_revision_id → wiki_page_revisions.id
-- Added after the revisions table exists to avoid a chicken-and-egg FK.
-- DEFERRABLE so we can INSERT page + first revision in the same transaction.
-- =============================================================================

ALTER TABLE "wiki_pages"
  ADD CONSTRAINT "wiki_pages_current_revision_fk"
  FOREIGN KEY ("current_revision_id") REFERENCES "wiki_page_revisions"("id")
  DEFERRABLE INITIALLY DEFERRED;

-- =============================================================================
-- search_tsv trigger — populate on insert/update of title/body
-- =============================================================================

CREATE OR REPLACE FUNCTION "wiki_revisions_tsv_update"()
  RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.body,  '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_wiki_revisions_tsv" ON "wiki_page_revisions";

CREATE TRIGGER "trg_wiki_revisions_tsv"
  BEFORE INSERT OR UPDATE OF "title", "body" ON "wiki_page_revisions"
  FOR EACH ROW EXECUTE FUNCTION "wiki_revisions_tsv_update"();

-- =============================================================================
-- updated_at trigger on wiki_pages
-- =============================================================================

CREATE OR REPLACE FUNCTION "wiki_pages_updated_at"()
  RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_wiki_pages_updated_at" ON "wiki_pages";

CREATE TRIGGER "trg_wiki_pages_updated_at"
  BEFORE UPDATE ON "wiki_pages"
  FOR EACH ROW EXECUTE FUNCTION "wiki_pages_updated_at"();
