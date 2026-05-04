-- =============================================================================
-- OPS: WIKI INTEGRATIONS — flip visibility to PUBLIC
-- =============================================================================
-- Atualiza as páginas do namespace `Integrations` (criadas pelo seed
-- `25-wiki-internal-integrations.sql`) para visibility = PUBLIC.
--
-- Use-case: o seed original foi rodado com `MYIO_INTERNAL` e queremos torná-lo
-- público sem precisar re-rodar o seed.
--
-- Idempotente — re-rodar é seguro.
-- =============================================================================

-- NOTE: this script is intended to be executed by drivers that don't accept
-- bare `BEGIN`/`COMMIT` (postgres-js raises UNSAFE_TRANSACTION). The UPDATE
-- below is naturally atomic; the SELECT is independent verification.
-- If you want full atomicity around multiple statements, wrap the call site
-- in `sql.begin(...)` (postgres-js) or use psql with `\set ON_ERROR_STOP on`.

-- 1) Atualiza visibility das páginas do namespace Integrations
UPDATE wiki_pages
SET
    visibility = ARRAY['PUBLIC']::text[],
    updated_at = now()
WHERE
    tenant_id  = '11111111-1111-1111-1111-111111111111'
    AND namespace = 'Integrations'
    AND visibility <> ARRAY['PUBLIC']::text[];

-- 2) Verifica resultado
SELECT
    namespace,
    slug,
    title,
    status,
    visibility
FROM wiki_pages
WHERE
    tenant_id = '11111111-1111-1111-1111-111111111111'
    AND namespace = 'Integrations'
ORDER BY slug;
