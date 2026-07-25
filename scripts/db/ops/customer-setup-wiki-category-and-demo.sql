-- =============================================================================
-- Customer SETUP — categoria + DEMO na WIKI (RFC-0030)
-- =============================================================================
--
-- /wiki/categories lista os NAMESPACES (wiki_namespaces) -> "categoria" = namespace.
-- Cada SETUP é uma PÁGINA (wiki_pages) no namespace, com o corpo em MARKDOWN
-- (renderizado de forma estável pelo PageRenderer via placeholder Phase-1).
--
-- DEMO (Moxuara): 1 presetup + 3 upsells na linha do tempo, link para o cliente.
--
-- Decisões (após iteração):
--   * Corpo em MARKDOWN LIMPO (não HTML cru) -> render estável, nunca "perde
--     formatação". Timeline = lista numerada.
--   * SEM lista de "anexos" no corpo: anexos reais são file_assets
--     (owner_type='wiki_page'), gerenciados pela aba de anexos da página.
--   * autor (created_by/author_id) resolvido POR SUBQUERY: admin@gcdr.io do
--     tenant, senão o user mais antigo -> funciona em local E prod sem editar.
--   * Link de volta para o cliente no corpo (/customers/<id>).
--
-- Idempotente e RE-EXECUTÁVEL (ON CONFLICT DO UPDATE + UUIDs fixos). Também
-- (re)cria o vínculo wiki_page_links (customer) — necessário para o card
-- "Wiki do cliente" na página do customer.
--
-- IDs inline:
--   tenant_id   = 11111111-1111-1111-1111-111111111111
--   customer_id = 84e0370e-636a-4741-9874-504b5e0b3577   (Moxuara / demo)
--   author      = resolvido dinamicamente (subquery users do tenant; NÃO hardcode)
--   page id     = 5e700000-0000-4000-8000-000000000001
--   revision id = 5e700000-0000-4000-8000-000000000002
--
-- ATENÇÃO: para aparecer em produção, rode no banco de PRODUÇÃO.
-- =============================================================================

BEGIN;

-- 1) CATEGORIA — namespace 'CustomerSetup'
INSERT INTO wiki_namespaces (tenant_id, name, description, review_required)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'CustomerSetup',
  'Setups por cliente: centrais (ipv6 + uuid), eventos (presetup/upsells) e status.',
  false
)
ON CONFLICT (tenant_id, name) DO UPDATE
  SET description = EXCLUDED.description;

-- 2) DEMO — página. frontmatter guarda os dados estruturados (status/centrais/eventos).
INSERT INTO wiki_pages (
  id, tenant_id, namespace, slug, title, status,
  tags, visibility, frontmatter, created_by, version
)
VALUES (
  '5e700000-0000-4000-8000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'CustomerSetup',
  'moxuara-setup-demo',
  'Setup Demo — Moxuara',
  'PUBLISHED',
  ARRAY['setup','moxuara']::text[],
  ARRAY['TENANT_PRIVATE']::text[],
  jsonb_build_object(
    'status', 'ACTIVE',
    'customerId', '84e0370e-636a-4741-9874-504b5e0b3577',
    'centrals', jsonb_build_array(
      jsonb_build_object('uuid','e982edf9-edb1-4aa6-8a14-4782465ae5a3','ipv6','fe80::1a2b:3c4d:5e6f:7a8b','label','Central Moxuara 1'),
      jsonb_build_object('uuid','00000000-0000-0000-0000-000000000002','ipv6','fe80::1a2b:3c4d:5e6f:7a8c','label','Central Moxuara 2 (entrada trafo)')
    ),
    'events', jsonb_build_array(
      jsonb_build_object('seq',1,'type','PRESETUP','title','Setup inicial','date','2024-02-15','status','DONE','description','Central Moxuara 1 + medição de energia (entrada).'),
      jsonb_build_object('seq',2,'type','UPSELL','title','Upsell 1 — Medição de água','date','2024-06-10','status','DONE','description','Medição de água do condomínio.'),
      jsonb_build_object('seq',3,'type','UPSELL','title','Upsell 2 — CAG / climatização','date','2024-11-05','status','DONE','description','Monitoramento da Central de Água Gelada.'),
      jsonb_build_object('seq',4,'type','UPSELL','title','Upsell 3 — Central 2.0 (entrada trafo)','date','2025-03-20','status','IN_PROGRESS','description','Segunda central na entrada do transformador.')
    ),
    'attachments', jsonb_build_array(
      jsonb_build_object('name','contrato-presetup.pdf','event',1,'fileAssetId', NULL),
      jsonb_build_object('name','aditivo-upsell-agua.pdf','event',2,'fileAssetId', NULL),
      jsonb_build_object('name','aditivo-upsell-cag.pdf','event',3,'fileAssetId', NULL)
    )
  ),
  (SELECT id FROM users WHERE tenant_id = '11111111-1111-1111-1111-111111111111' ORDER BY (email = 'admin@gcdr.io') DESC, created_at ASC LIMIT 1),
  1
)
ON CONFLICT (id) DO UPDATE SET
  title       = EXCLUDED.title,
  status      = EXCLUDED.status,
  tags        = EXCLUDED.tags,
  frontmatter = EXCLUDED.frontmatter,
  created_by  = EXCLUDED.created_by,
  updated_at  = now();

-- 3) Revisão. Corpo em MARKDOWN; body_html = placeholder Phase-1 (o PageRenderer
--    extrai o markdown e renderiza com markdown-it -> estável e consistente).
WITH md AS (
  SELECT
    E'# Setup Demo — Moxuara\n\n'
    || E'**Status:** ACTIVE  ·  **Cliente:** [Moxuara — detalhes do cliente](/customers/84e0370e-636a-4741-9874-504b5e0b3577)\n\n'
    || E'## Centrais\n\n| Label | UUID | IPv6 |\n|---|---|---|\n'
    || E'| Central Moxuara 1 | e982edf9-edb1-4aa6-8a14-4782465ae5a3 | fe80::1a2b:3c4d:5e6f:7a8b |\n'
    || E'| Central Moxuara 2 (entrada trafo) | 00000000-0000-0000-0000-000000000002 | fe80::1a2b:3c4d:5e6f:7a8c |\n\n'
    || E'## Linha do tempo\n\n'
    || E'1. **2024-02-15 — Setup inicial** _(presetup · DONE)_ — Central Moxuara 1 + medição de energia (entrada).\n'
    || E'2. **2024-06-10 — Upsell 1: Medição de água** _(DONE)_ — medição de água do condomínio.\n'
    || E'3. **2024-11-05 — Upsell 2: CAG / climatização** _(DONE)_ — central de água gelada.\n'
    || E'4. **2025-03-20 — Upsell 3: Central 2.0 (entrada trafo)** _(IN_PROGRESS)_ — segunda central na entrada do transformador.\n\n'
    || E'> Anexos: use a aba de anexos desta página (upload real via file_assets).'
    AS body
)
INSERT INTO wiki_page_revisions (
  id, page_id, revision_number, title, body, body_html, frontmatter, change_note, author_id
)
SELECT
  '5e700000-0000-4000-8000-000000000002',
  '5e700000-0000-4000-8000-000000000001',
  1,
  'Setup Demo — Moxuara',
  md.body,
  '<pre class="wiki-body-placeholder">'
    || replace(replace(replace(replace(md.body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
    || '</pre>',
  '{}'::jsonb,
  'seed — presetup + 3 upsells (timeline) + link cliente',
  (SELECT id FROM users WHERE tenant_id = '11111111-1111-1111-1111-111111111111' ORDER BY (email = 'admin@gcdr.io') DESC, created_at ASC LIMIT 1)
FROM md
ON CONFLICT (id) DO UPDATE SET
  title       = EXCLUDED.title,
  body        = EXCLUDED.body,
  body_html   = EXCLUDED.body_html,
  author_id   = EXCLUDED.author_id,
  change_note = EXCLUDED.change_note;

-- 4) Aponta a revisão corrente.
UPDATE wiki_pages
   SET current_revision_id = '5e700000-0000-4000-8000-000000000002',
       updated_at = now()
 WHERE id = '5e700000-0000-4000-8000-000000000001';

-- 5) Vínculo com o cliente (necessário p/ o card "Wiki do cliente" e backlinks).
INSERT INTO wiki_page_links (page_id, entity_type, entity_id)
VALUES (
  '5e700000-0000-4000-8000-000000000001',
  'customer',
  '84e0370e-636a-4741-9874-504b5e0b3577'
)
ON CONFLICT (page_id, entity_type, entity_id) DO NOTHING;

COMMIT;

-- Conferência
SELECT p.title, p.status, p.current_revision_id IS NOT NULL AS tem_revisao,
       (SELECT count(*) FROM wiki_page_links l WHERE l.page_id = p.id AND l.entity_type='customer') AS links_customer
FROM wiki_pages p
WHERE p.id = '5e700000-0000-4000-8000-000000000001';
