-- =============================================================================
-- DRY RUN — conferência para limpeza de customers de teste
-- =============================================================================
-- READ-ONLY: nenhum DELETE/UPDATE aqui. Três resultados:
--   1) candidatos + descendentes, com o raio de impacto (contagens por tabela)
--   2) totais gerais do que a limpeza arrastaria
--   3) amostra de nomes que só casam por substring (possíveis falsos positivos)
--
-- Critério de match:
--   - 'word'     → "teste"/"testes"/"test" como PALAVRA no name/display_name
--                  (regex \m..\M, case-insensitive) — alta confiança
--   - 'contains' → substring "test" em qualquer lugar — pega "TESTE123",
--                  "cliente_teste" etc., mas TAMBÉM palavras legítimas como
--                  "TESTEIRA" (fachada de loja!) — conferir a olho
--   - 'dragged'  → NÃO casa por nome, mas é DESCENDENTE (path) de um que casa;
--                  a limpeza arrastaria junto — conferir com atenção redobrada
-- =============================================================================

WITH matched AS (
  SELECT id, path,
         CASE WHEN name ~* '\mtestes?\M' OR display_name ~* '\mtestes?\M'
              THEN 'word' ELSE 'contains' END AS match_kind
  FROM customers
  WHERE deleted_at IS NULL
    AND (name ILIKE '%test%' OR display_name ILIKE '%test%')
),
alvo AS (
  SELECT DISTINCT ON (c.id) c.*, COALESCE(m.match_kind, 'dragged') AS match_kind
  FROM customers c
  JOIN matched root
    ON c.id = root.id OR c.path LIKE root.path || '/%'
  LEFT JOIN matched m ON m.id = c.id
  WHERE c.deleted_at IS NULL
  ORDER BY c.id, m.match_kind NULLS LAST
)
SELECT
  a.match_kind,
  a.type,
  a.status,
  a.name,
  a.display_name,
  a.code,
  a.id,
  a.created_at::date                                                        AS criado_em,
  (SELECT count(*) FROM customers ch WHERE ch.parent_customer_id = a.id
     AND ch.deleted_at IS NULL)                                             AS filhos,
  (SELECT count(*) FROM assets    x  WHERE x.customer_id = a.id)            AS assets,
  (SELECT count(*) FROM devices   x  WHERE x.customer_id = a.id)            AS devices,
  (SELECT count(*) FROM centrals  x  WHERE x.customer_id = a.id)            AS centrals,
  (SELECT count(*) FROM users     x  WHERE x.customer_id = a.id)            AS users,
  (SELECT count(*) FROM rules     x  WHERE x.customer_id = a.id)            AS rules,
  (SELECT count(*) FROM work_orders x WHERE x.customer_id = a.id
     AND x.deleted_at IS NULL)                                              AS work_orders,
  (SELECT count(*) FROM consumption_goals x WHERE x.customer_id = a.id)     AS goals,
  (SELECT count(*) FROM customer_api_keys x WHERE x.customer_id = a.id)     AS api_keys,
  (SELECT count(*) FROM groups    x  WHERE x.customer_id = a.id)            AS groups,
  (SELECT count(*) FROM entities  x  WHERE x.customer_id = a.id)            AS entities,
  (SELECT count(*) FROM annotations x WHERE x.customer_id = a.id
     AND x.deleted_at IS NULL)                                              AS annotations,
  (SELECT count(*) FROM look_and_feels x WHERE x.customer_id = a.id)        AS themes,
  (SELECT count(*) FROM alarm_bundle_versions x WHERE x.customer_id = a.id) AS bundle_versions,
  (SELECT count(*) FROM audit_logs x WHERE x.customer_id = a.id)            AS audit_logs
FROM alvo a
ORDER BY
  CASE a.match_kind WHEN 'word' THEN 0 WHEN 'contains' THEN 1 ELSE 2 END,
  a.path;

-- ── 2) Totais gerais ─────────────────────────────────────────────────────────
WITH matched AS (
  SELECT id, path FROM customers
  WHERE deleted_at IS NULL
    AND (name ILIKE '%test%' OR display_name ILIKE '%test%')
),
alvo AS (
  SELECT DISTINCT c.id FROM customers c
  JOIN matched root ON c.id = root.id OR c.path LIKE root.path || '/%'
  WHERE c.deleted_at IS NULL
)
SELECT
  (SELECT count(*) FROM alvo)                                              AS customers,
  (SELECT count(*) FROM assets      WHERE customer_id IN (SELECT id FROM alvo)) AS assets,
  (SELECT count(*) FROM devices     WHERE customer_id IN (SELECT id FROM alvo)) AS devices,
  (SELECT count(*) FROM centrals    WHERE customer_id IN (SELECT id FROM alvo)) AS centrals,
  (SELECT count(*) FROM users       WHERE customer_id IN (SELECT id FROM alvo)) AS users,
  (SELECT count(*) FROM rules       WHERE customer_id IN (SELECT id FROM alvo)) AS rules,
  (SELECT count(*) FROM work_orders WHERE customer_id IN (SELECT id FROM alvo)
     AND deleted_at IS NULL)                                               AS work_orders,
  (SELECT count(*) FROM consumption_goals  WHERE customer_id IN (SELECT id FROM alvo)) AS goals,
  (SELECT count(*) FROM customer_api_keys  WHERE customer_id IN (SELECT id FROM alvo)) AS api_keys,
  (SELECT count(*) FROM entities    WHERE customer_id IN (SELECT id FROM alvo)) AS entities,
  (SELECT count(*) FROM annotations WHERE customer_id IN (SELECT id FROM alvo)
     AND deleted_at IS NULL)                                               AS annotations,
  (SELECT count(*) FROM audit_logs  WHERE customer_id IN (SELECT id FROM alvo)) AS audit_logs;

-- ── 3) Possíveis falsos positivos (só substring, sem a palavra "teste") ─────
SELECT id, name, display_name, code, type, status
FROM customers
WHERE deleted_at IS NULL
  AND (name ILIKE '%test%' OR display_name ILIKE '%test%')
  AND NOT (name ~* '\mtestes?\M' OR display_name ~* '\mtestes?\M')
ORDER BY name;
