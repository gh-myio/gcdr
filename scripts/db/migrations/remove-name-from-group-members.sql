-- =============================================================================
-- Remove campo "name" do array JSONB groups.members
--
-- Contexto: name era desnormalizado no JSONB mas deve ser buscado em tempo
-- real da tabela users. Apenas id, type, addedAt, addedBy e metadata
-- devem ser armazenados em members.
--
-- Seguro rodar múltiplas vezes (membros sem "name" não são afetados).
-- =============================================================================

UPDATE groups
SET members = (
  SELECT jsonb_agg(
    m - 'name'   -- remove o campo name de cada elemento
  )
  FROM jsonb_array_elements(members) AS m
)
WHERE members @> '[{"name": ""}]'::jsonb = false   -- evita no-op desnecessário
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(members) AS m
    WHERE m ? 'name'
  );

-- Verificação
SELECT
  id,
  name AS group_name,
  jsonb_array_length(members) AS member_count,
  (
    SELECT count(*)
    FROM jsonb_array_elements(members) AS m
    WHERE m ? 'name'
  ) AS members_with_name_field
FROM groups
WHERE jsonb_array_length(members) > 0
ORDER BY members_with_name_field DESC
LIMIT 20;
-- Esperado: members_with_name_field = 0 em todos os grupos
