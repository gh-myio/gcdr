-- =============================================================================
-- create-sa-cavalcante-customer.sql
-- Cria o customer "Sá Cavalcante" como pai de:
--   Mestre Álvaro  e04046d4-baa4-44e9-a378-4dfebe4140f1
--   Mont Serrat    a4c64215-f7eb-4102-80b5-e10b98e2f94e
--   Moxuara        84e0370e-636a-4741-9874-504b5e0b3577
--
-- Uso:  npm run db:ops scripts/db/ops/create-sa-cavalcante-customer.sql
-- =============================================================================

DO $$
DECLARE
  v_tenant_id   uuid := '11111111-1111-1111-1111-111111111111';
  v_sc_id       uuid := 'b1000000-0000-0000-0000-000000000001'; -- ID fixo para Sá Cavalcante
  v_sc_code     text := 'SA-CAVALCANTE';
  v_sc_name     text := 'Sá Cavalcante';

  -- parent de Sá Cavalcante = parent atual de um dos filhos (todos devem ter o mesmo)
  v_parent_id   uuid;
  v_parent_path text;
  v_parent_depth int;

  v_sc_depth    int;
  v_sc_path     text;

  v_child       record;
  v_old_path    text;
  v_new_path    text;
BEGIN

  -- ----------------------------------------------------------------
  -- 1. Descobre o parent atual de Mestre Álvaro
  --    (Sá Cavalcante herdará esse mesmo parent)
  -- ----------------------------------------------------------------
  SELECT parent_customer_id, path, depth
  INTO v_parent_id, v_old_path, v_parent_depth
  FROM customers
  WHERE id = 'e04046d4-baa4-44e9-a378-4dfebe4140f1'
    AND tenant_id = v_tenant_id;

  IF v_parent_id IS NOT NULL THEN
    SELECT path INTO v_parent_path
    FROM customers
    WHERE id = v_parent_id AND tenant_id = v_tenant_id;
    v_sc_depth := v_parent_depth; -- mesmo nível que Mestre Álvaro hoje
    v_sc_path  := v_parent_path || '/' || v_sc_id;
  ELSE
    -- Mestre Álvaro é root → Sá Cavalcante também é root (depth 0)
    v_sc_depth := 0;
    v_sc_path  := '/' || v_tenant_id || '/' || v_sc_id;
  END IF;

  -- ----------------------------------------------------------------
  -- 2. Insere Sá Cavalcante (idempotente)
  -- ----------------------------------------------------------------
  INSERT INTO customers (
    id, tenant_id, parent_customer_id,
    name, display_name, code, type,
    path, depth,
    status, settings, theme, metadata, config,
    created_at, updated_at, version
  )
  SELECT
    v_sc_id,
    v_tenant_id,
    v_parent_id,
    v_sc_name,
    v_sc_name,
    v_sc_code,
    'HOLDING',
    v_sc_path,
    v_sc_depth,
    'ACTIVE',
    '{}'::jsonb,
    NULL,
    '{}'::jsonb,
    NULL,
    NOW(),
    NOW(),
    1
  WHERE NOT EXISTS (
    SELECT 1 FROM customers WHERE id = v_sc_id
  );

  IF FOUND THEN
    RAISE NOTICE 'Customer "%" criado com id=%', v_sc_name, v_sc_id;
  ELSE
    RAISE NOTICE 'Customer "%" já existe, pulando INSERT.', v_sc_name;
  END IF;

  -- ----------------------------------------------------------------
  -- 3. Atualiza os 3 filhos: novo parent + path + depth
  -- ----------------------------------------------------------------
  FOR v_child IN
    SELECT id, name, path, depth
    FROM customers
    WHERE id IN (
      'e04046d4-baa4-44e9-a378-4dfebe4140f1', -- Mestre Álvaro
      'a4c64215-f7eb-4102-80b5-e10b98e2f94e', -- Mont Serrat
      '84e0370e-636a-4741-9874-504b5e0b3577'  -- Moxuara
    )
    AND tenant_id = v_tenant_id
  LOOP
    v_old_path := v_child.path;
    v_new_path := v_sc_path || '/' || v_child.id;

    UPDATE customers
    SET
      parent_customer_id = v_sc_id,
      path               = v_new_path,
      depth              = v_sc_depth + 1,
      updated_at         = NOW(),
      version            = version + 1
    WHERE id = v_child.id AND tenant_id = v_tenant_id;

    RAISE NOTICE 'Customer "%" atualizado: path % → %, depth % → %',
      v_child.name, v_old_path, v_new_path, v_child.depth, v_sc_depth + 1;

    -- Atualiza descendentes do filho (se houver sub-filhos)
    UPDATE customers
    SET
      path       = replace(path, v_old_path, v_new_path),
      depth      = depth + (v_sc_depth + 1 - v_child.depth),
      updated_at = NOW(),
      version    = version + 1
    WHERE tenant_id = v_tenant_id
      AND path LIKE v_old_path || '/%';

    IF FOUND THEN
      RAISE NOTICE '  → sub-descendentes de "%" atualizados.', v_child.name;
    END IF;
  END LOOP;

END $$;

-- ----------------------------------------------------------------
-- Verificação final
-- ----------------------------------------------------------------
SELECT
  c.id,
  c.name,
  c.type,
  c.depth,
  c.path,
  p.name AS parent_name
FROM customers c
LEFT JOIN customers p ON p.id = c.parent_customer_id
WHERE c.tenant_id = '11111111-1111-1111-1111-111111111111'
  AND c.id IN (
    'b1000000-0000-0000-0000-000000000001', -- Sá Cavalcante
    'e04046d4-baa4-44e9-a378-4dfebe4140f1', -- Mestre Álvaro
    'a4c64215-f7eb-4102-80b5-e10b98e2f94e', -- Mont Serrat
    '84e0370e-636a-4741-9874-504b5e0b3577'  -- Moxuara
  )
ORDER BY c.depth, c.name;
