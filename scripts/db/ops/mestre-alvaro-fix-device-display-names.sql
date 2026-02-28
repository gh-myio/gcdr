-- =============================================================================
-- FIX: Device display_name com trailing space — Mestre Álvaro
-- Customer: e04046d4-baa4-44e9-a378-4dfebe4140f1
--
-- Problema: display_name = 'ER 1 ' (espaço trailing) em vez de 'ER 14'
-- Causa: ThingsBoard sync envia label com espaço no final
-- Fix: BTRIM em name e display_name de todos os devices do customer
-- =============================================================================

-- PASSO 1: Diagnóstico — ver o que está errado antes de corrigir
SELECT
  id,
  slave_id,
  name,
  display_name,
  length(name)         AS name_len,
  length(display_name) AS dname_len,
  name         != btrim(name)         AS name_has_space,
  display_name != btrim(display_name) AS dname_has_space
FROM devices
WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
  AND tenant_id  = '11111111-1111-1111-1111-111111111111'
  AND (
    name         != btrim(name)
    OR display_name != btrim(display_name)
  )
ORDER BY slave_id;

-- PASSO 2: Fix — BTRIM em name e display_name onde há espaços sobrando
UPDATE devices
SET
  name         = btrim(name),
  display_name = btrim(display_name),
  updated_at   = NOW(),
  version      = version + 1
WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
  AND tenant_id  = '11111111-1111-1111-1111-111111111111'
  AND (
    name         != btrim(name)
    OR display_name != btrim(display_name)
  );

-- PASSO 3: Verificação final — todos os dispositivos com seus nomes limpos
SELECT
  slave_id,
  name,
  display_name,
  status
FROM devices
WHERE customer_id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
  AND tenant_id  = '11111111-1111-1111-1111-111111111111'
ORDER BY slave_id;
