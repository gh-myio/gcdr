-- =============================================================================
-- RFC-0024 — Mestre Álvaro: Adicionar membros ao grupo existente
--
-- Customer  : Mestre Álvaro  (e04046d4-baa4-44e9-a378-4dfebe4140f1)
-- Tenant    : 11111111-1111-1111-1111-111111111111
-- Grupo     : 6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c  (Manutenção Escadas Rolantes)
--
-- Etapa 2/3 — Inserir João e Maria no array members do grupo
--
-- Usa jsonb_set + || para acrescentar sem duplicar (verifica pelo id antes).
-- =============================================================================

-- Visualizar estado atual do grupo antes de alterar
SELECT id, name, members, member_count
FROM groups
WHERE id = '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c';

-- ----------------------------------------------------------------------------
-- Adiciona João ao grupo (somente se ainda não for membro)
-- ----------------------------------------------------------------------------
UPDATE groups
SET
  members = members || '[{
    "id":      "eeee0001-0001-0001-0001-000000000001",
    "type":    "USER",
    "name":    "João Silva",
    "addedAt": "2026-03-16T00:00:00Z"
  }]'::jsonb,
  member_count = member_count + 1,
  version      = version + 1
WHERE id = '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(members) AS m
    WHERE m->>'id' = 'eeee0001-0001-0001-0001-000000000001'
  );

-- ----------------------------------------------------------------------------
-- Adiciona Maria ao grupo (somente se ainda não for membro)
-- ----------------------------------------------------------------------------
UPDATE groups
SET
  members = members || '[{
    "id":      "eeee0001-0001-0001-0001-000000000002",
    "type":    "USER",
    "name":    "Maria Souza",
    "addedAt": "2026-03-16T00:00:00Z"
  }]'::jsonb,
  member_count = member_count + 1,
  version      = version + 1
WHERE id = '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(members) AS m
    WHERE m->>'id' = 'eeee0001-0001-0001-0001-000000000002'
  );

-- Verificação
SELECT
  id,
  name,
  member_count,
  jsonb_array_length(members) AS members_json_count,
  members
FROM groups
WHERE id = '6c2bc47d-ae95-4bc3-bbf2-e2def3652f8c';
-- Esperado: member_count = 2, members_json_count = 2
