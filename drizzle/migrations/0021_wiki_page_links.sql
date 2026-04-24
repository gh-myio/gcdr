-- Migration 0021: RFC-0030 Phase 2 — wiki_page_links
--
-- Polymorphic link table: each row connects a wiki page to an entity in
-- another domain (device / customer / rule / asset / central / group /
-- user / rfc). Populated at page save time by the server-side body
-- parser, which extracts `@type:uuid` tokens.
--
-- Backlinks query:
--   SELECT p.*
--   FROM wiki_page_links l
--   JOIN wiki_pages p ON p.id = l.page_id
--   WHERE l.entity_type = $1 AND l.entity_id = $2
--         AND p.tenant_id = $3 AND p.visibility && $4;

CREATE TABLE IF NOT EXISTS "wiki_page_links" (
  "page_id"      uuid NOT NULL REFERENCES "wiki_pages"("id") ON DELETE CASCADE,
  "entity_type"  text NOT NULL,
  "entity_id"    text NOT NULL,
  CONSTRAINT "wiki_page_links_pk"
    PRIMARY KEY ("page_id", "entity_type", "entity_id"),
  CONSTRAINT "wiki_page_links_entity_type_check"
    CHECK ("entity_type" IN (
      'device','customer','rule','asset',
      'central','group','user','rfc'
    ))
);

CREATE INDEX IF NOT EXISTS "idx_wiki_page_links_entity"
  ON "wiki_page_links" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "idx_wiki_page_links_page"
  ON "wiki_page_links" ("page_id");
