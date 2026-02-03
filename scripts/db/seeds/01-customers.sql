-- =============================================================================
-- SEED: CUSTOMERS
-- =============================================================================
-- Mock data for customers table (hierarchical structure)
-- =============================================================================

-- Use a fixed tenant ID for all test data
DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_holding_id UUID := '22222222-2222-2222-2222-222222222222';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_company2_id UUID := '44444444-4444-4444-4444-444444444444';
    v_branch1_id UUID := '55555555-5555-5555-5555-555555555555';
    v_branch2_id UUID := '66666666-6666-6666-6666-666666666666';
    v_dimension_id UUID := '77777777-7777-7777-7777-777777777777';
BEGIN
    -- Holding (root customer)
    INSERT INTO customers (id, tenant_id, parent_customer_id, path, depth, name, display_name, code, type, email, phone, address, settings, metadata, status, version)
    VALUES (
        v_holding_id,
        v_tenant_id,
        NULL,
        '/' || v_tenant_id || '/' || v_holding_id,
        0,
        'ACME Holdings',
        'ACME Holdings S.A.',
        'ACME-HOLD',
        'HOLDING',
        'contact@acmeholdings.com',
        '+55 11 3000-0000',
        '{"street": "Av. Paulista, 1000", "city": "São Paulo", "state": "SP", "country": "Brazil", "postalCode": "01310-100"}',
        '{"timezone": "America/Sao_Paulo", "language": "pt-BR", "currency": "BRL"}',
        '{"industry": "Technology", "employees": 5000}',
        'ACTIVE',
        1
    );

    -- Company 1 (child of holding)
    INSERT INTO customers (id, tenant_id, parent_customer_id, path, depth, name, display_name, code, type, email, phone, address, settings, metadata, status, version)
    VALUES (
        v_company1_id,
        v_tenant_id,
        v_holding_id,
        '/' || v_tenant_id || '/' || v_holding_id || '/' || v_company1_id,
        1,
        'ACME Tech',
        'ACME Technology Ltda.',
        'ACME-TECH',
        'COMPANY',
        'tech@acme.com',
        '+55 11 3001-0000',
        '{"street": "Rua Augusta, 500", "city": "São Paulo", "state": "SP", "country": "Brazil", "postalCode": "01304-000"}',
        '{"timezone": "America/Sao_Paulo", "language": "pt-BR", "currency": "BRL"}',
        '{"industry": "Software", "employees": 200}',
        'ACTIVE',
        1
    );

    -- Company 2 (child of holding)
    INSERT INTO customers (id, tenant_id, parent_customer_id, path, depth, name, display_name, code, type, email, phone, address, settings, metadata, status, version)
    VALUES (
        v_company2_id,
        v_tenant_id,
        v_holding_id,
        '/' || v_tenant_id || '/' || v_holding_id || '/' || v_company2_id,
        1,
        'ACME Industrial',
        'ACME Industrial S.A.',
        'ACME-IND',
        'COMPANY',
        'industrial@acme.com',
        '+55 11 3002-0000',
        '{"street": "Av. Industrial, 1500", "city": "Guarulhos", "state": "SP", "country": "Brazil", "postalCode": "07000-000"}',
        '{"timezone": "America/Sao_Paulo", "language": "pt-BR", "currency": "BRL"}',
        '{"industry": "Manufacturing", "employees": 800}',
        'ACTIVE',
        1
    );

    -- Branch 1 (child of Company 1)
    INSERT INTO customers (id, tenant_id, parent_customer_id, path, depth, name, display_name, code, type, email, phone, address, settings, metadata, status, version)
    VALUES (
        v_branch1_id,
        v_tenant_id,
        v_company1_id,
        '/' || v_tenant_id || '/' || v_holding_id || '/' || v_company1_id || '/' || v_branch1_id,
        2,
        'ACME Tech - SP',
        'ACME Tech Filial São Paulo',
        'ACME-TECH-SP',
        'BRANCH',
        'sp@acmetech.com',
        '+55 11 3003-0000',
        '{"street": "Rua Bela Cintra, 200", "city": "São Paulo", "state": "SP", "country": "Brazil", "postalCode": "01415-000"}',
        '{"timezone": "America/Sao_Paulo", "language": "pt-BR", "currency": "BRL"}',
        '{"branch_type": "development", "employees": 50}',
        'ACTIVE',
        1
    );

    -- Branch 2 (child of Company 1)
    INSERT INTO customers (id, tenant_id, parent_customer_id, path, depth, name, display_name, code, type, email, phone, address, settings, metadata, status, version)
    VALUES (
        v_branch2_id,
        v_tenant_id,
        v_company1_id,
        '/' || v_tenant_id || '/' || v_holding_id || '/' || v_company1_id || '/' || v_branch2_id,
        2,
        'ACME Tech - RJ',
        'ACME Tech Filial Rio de Janeiro',
        'ACME-TECH-RJ',
        'BRANCH',
        'rj@acmetech.com',
        '+55 21 3004-0000',
        '{"street": "Av. Rio Branco, 100", "city": "Rio de Janeiro", "state": "RJ", "country": "Brazil", "postalCode": "20040-000"}',
        '{"timezone": "America/Sao_Paulo", "language": "pt-BR", "currency": "BRL"}',
        '{"branch_type": "sales", "employees": 30}',
        'ACTIVE',
        1
    );

    -- Company 3 - Dimension (child of holding)
    INSERT INTO customers (id, tenant_id, parent_customer_id, path, depth, name, display_name, code, type, email, phone, address, settings, metadata, status, version)
    VALUES (
        v_dimension_id,
        v_tenant_id,
        v_holding_id,
        '/' || v_tenant_id || '/' || v_holding_id || '/' || v_dimension_id,
        1,
        'Dimension',
        'Dimension Engenharia Ltda.',
        'DIMENSION',
        'COMPANY',
        'contato@dimension.com.br',
        '+55 11 3005-0000',
        '{"street": "Av. Brigadeiro Faria Lima, 2000", "city": "São Paulo", "state": "SP", "country": "Brazil", "postalCode": "01451-000"}',
        '{"timezone": "America/Sao_Paulo", "language": "pt-BR", "currency": "BRL"}',
        '{"industry": "Engineering", "employees": 150}',
        'ACTIVE',
        1
    );

    RAISE NOTICE 'Inserted 6 customers';
END $$;

-- Verify
SELECT id, name, code, type, depth, status FROM customers ORDER BY depth, name;
