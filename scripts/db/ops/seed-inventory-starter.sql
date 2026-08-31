-- =============================================================================
-- OPS: seed inicial do Inventory (RFC-0061) — itens de exemplo + BOM + estoque
-- =============================================================================
-- Popula o menu Estoque com dados reais mínimos para operar/demonstrar:
--   - 8 itens nos 4 domínios (nomes do catálogo real do "Myio Compras")
--   - BOM do "Medidor 3F MYIO" (3 componentes, com perda em um deles)
--   - Movimentos de ENTRADA iniciais (saldos aparecem no Livro-razão)
--   - 2 projetos (um vinculado ao customer Myio)
--
-- Idempotente: UUIDs fixos + ON CONFLICT DO NOTHING (rodar 2x não duplica).
-- Tenant default. Rodar no DB Admin (allow write) ou psql.
-- Reverter (se quiser limpar): DELETE FROM inv_stock_movements WHERE created_by IS NULL AND reason LIKE 'Seed inicial%';
--                              DELETE FROM inv_boms WHERE product_item_id = 'a0610061-0000-4000-9000-000000000001';
--                              DELETE FROM inv_items WHERE id::text LIKE 'a0610061-%';
--                              DELETE FROM inv_projects WHERE id::text LIKE 'b0610061-%';
-- =============================================================================

-- ── Itens ────────────────────────────────────────────────────────────────────
INSERT INTO inv_items (id, tenant_id, name, domain, description, is_manufactured, loss_percent, purchase_type) VALUES
 ('a0610061-0000-4000-9000-000000000001', '11111111-1111-1111-1111-111111111111', 'Medidor 3F MYIO',        'PRODUCT',     'Medidor trifásico MYIO (produto fabricado)', true,  0, NULL),
 ('a0610061-0000-4000-9000-000000000002', '11111111-1111-1111-1111-111111111111', 'Hidrômetro MYIO',        'PRODUCT',     'Hidrômetro com telemetria (produto fabricado)', true, 0, NULL),
 ('a0610061-0000-4000-9000-000000000003', '11111111-1111-1111-1111-111111111111', 'PCB Principal MYIO',     'COMPONENT',   'Placa principal do medidor', false, 2.5, 'IMPORTACAO'),
 ('a0610061-0000-4000-9000-000000000004', '11111111-1111-1111-1111-111111111111', 'Caixa Plastica IP65',    'COMPONENT',   'Enclosure IP65', false, 0, 'NACIONAL'),
 ('a0610061-0000-4000-9000-000000000005', '11111111-1111-1111-1111-111111111111', 'Conector RJ45',          'COMPONENT',   'Conector de rede', false, 0, 'NACIONAL'),
 ('a0610061-0000-4000-9000-000000000006', '11111111-1111-1111-1111-111111111111', 'TC 100A/50mA Sct-013',   'THIRD_PARTY', 'Transformador de corrente (revenda)', false, 0, 'NACIONAL'),
 ('a0610061-0000-4000-9000-000000000007', '11111111-1111-1111-1111-111111111111', 'Disjuntor 3F Siemens',   'THIRD_PARTY', 'Disjuntor trifasico (revenda)', false, 0, 'NACIONAL'),
 ('a0610061-0000-4000-9000-000000000008', '11111111-1111-1111-1111-111111111111', 'Multimetro Fluke 87V',   'TOOL',        'Multimetro de bancada (ativo/ferramenta)', false, 0, 'IMPORTACAO')
ON CONFLICT DO NOTHING;

-- ── BOM do Medidor 3F: 1 PCB + 1 caixa + 2 conectores ───────────────────
-- (itens resolvidos POR NOME: robusto mesmo se ja existirem com outros ids)
INSERT INTO inv_boms (tenant_id, product_item_id, component_item_id, quantity)
SELECT p.tenant_id, p.id, c.id, x.qty
FROM (VALUES ('PCB Principal MYIO', 1::numeric), ('Caixa Plastica IP65', 1), ('Conector RJ45', 2)) AS x(comp, qty)
JOIN inv_items p ON p.tenant_id='11111111-1111-1111-1111-111111111111' AND p.domain='PRODUCT'   AND p.normalized_name=lower('Medidor 3F MYIO')
JOIN inv_items c ON c.tenant_id=p.tenant_id                             AND c.domain='COMPONENT' AND c.normalized_name=lower(x.comp)
WHERE NOT EXISTS (SELECT 1 FROM inv_boms b WHERE b.product_item_id=p.id AND b.component_item_id=c.id);

-- ── Saldos iniciais (ENTRADA; por nome; nao duplica se ja houver seed) ──────
INSERT INTO inv_stock_movements (tenant_id, item_id, location, quantity, type, reason)
SELECT i.tenant_id, i.id, x.loc, x.qty, 'ENTRADA', 'Seed inicial do inventory'
FROM (VALUES
  ('COMPONENT',   'PCB Principal MYIO',    'FABRICA',            100::numeric),
  ('COMPONENT',   'Caixa Plastica IP65',   'FABRICA',             80),
  ('COMPONENT',   'Conector RJ45',         'FABRICA',            200),
  ('THIRD_PARTY', 'TC 100A/50mA Sct-013',  'ALMOXARIFADO',        50),
  ('THIRD_PARTY', 'Disjuntor 3F Siemens',  'ALMOXARIFADO',        12),
  ('TOOL',        'Multimetro Fluke 87V',  'ALMOXARIFADO_GERAL',   3)
) AS x(dom, nome, loc, qty)
JOIN inv_items i ON i.tenant_id='11111111-1111-1111-1111-111111111111' AND i.domain=x.dom AND i.normalized_name=lower(x.nome)
WHERE NOT EXISTS (
  SELECT 1 FROM inv_stock_movements m
  WHERE m.item_id=i.id AND m.reason='Seed inicial do inventory'
);

-- ── Projetos ─────────────────────────────────────────────────────────────────
INSERT INTO inv_projects (id, tenant_id, name, description, customer_id) VALUES
 ('b0610061-0000-4000-9000-000000000001', '11111111-1111-1111-1111-111111111111', 'Fabrica Myio',            'Operacao interna da fabrica', '56614a70-326f-11ef-ad2c-53aeabe7d3fa'),
 ('b0610061-0000-4000-9000-000000000002', '11111111-1111-1111-1111-111111111111', 'Novos Produtos P&D',      'Pesquisa e desenvolvimento', NULL)
ON CONFLICT DO NOTHING;

-- ── Conferência ────────────────────────────────────────────────────────
SELECT 'itens seed' AS o, count(*) FROM inv_items WHERE id::text LIKE 'a0610061-%'
UNION ALL SELECT 'bom (medidor)', count(*) FROM inv_boms b JOIN inv_items p ON p.id=b.product_item_id AND p.normalized_name=lower('Medidor 3F MYIO')
UNION ALL SELECT 'movimentos seed', count(*) FROM inv_stock_movements WHERE reason='Seed inicial do inventory'
UNION ALL SELECT 'projetos seed', count(*) FROM inv_projects WHERE id::text LIKE 'b0610061-%';
