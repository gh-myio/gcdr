-- =============================================================================
-- SEED: DOMAIN PERMISSIONS (RFC-0013)
-- =============================================================================
-- Hierarchical domain permissions in format: domain.equipment.location:action
-- =============================================================================

DO $$
BEGIN
    -- =========================================================================
    -- WATER DOMAIN
    -- =========================================================================

    -- Water > Hidrometro > Entry
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'water', 'hidrometro', 'entry', 'read', 'Leitura Hidrometro Entrada', 'Ver dados do hidrometro da entrada', 'low'),
        (NULL, 'water', 'hidrometro', 'entry', 'update', 'Atualizar Hidrometro Entrada', 'Modificar configuracoes do hidrometro da entrada', 'medium');

    -- Water > Hidrometro > Common Area
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'water', 'hidrometro', 'common_area', 'read', 'Leitura Hidrometro Area Comum', 'Ver dados do hidrometro da area comum', 'low'),
        (NULL, 'water', 'hidrometro', 'common_area', 'update', 'Atualizar Hidrometro Area Comum', 'Modificar configuracoes do hidrometro da area comum', 'medium');

    -- Water > Hidrometro > Stores
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'water', 'hidrometro', 'stores', 'read', 'Leitura Hidrometro Lojas', 'Ver dados do hidrometro das lojas', 'low'),
        (NULL, 'water', 'hidrometro', 'stores', 'update', 'Atualizar Hidrometro Lojas', 'Modificar configuracoes do hidrometro das lojas', 'medium');

    -- =========================================================================
    -- ENERGY DOMAIN
    -- =========================================================================

    -- Energy > Hidrometro (medidor de energia) > Entry
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'energy', 'hidrometro', 'entry', 'read', 'Leitura Medidor Energia Entrada', 'Ver dados do medidor de energia da entrada', 'low'),
        (NULL, 'energy', 'hidrometro', 'entry', 'update', 'Atualizar Medidor Energia Entrada', 'Modificar configuracoes do medidor de energia da entrada', 'medium');

    -- Energy > Hidrometro > Common Area
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'energy', 'hidrometro', 'common_area', 'read', 'Leitura Medidor Energia Area Comum', 'Ver dados do medidor de energia da area comum', 'low'),
        (NULL, 'energy', 'hidrometro', 'common_area', 'update', 'Atualizar Medidor Energia Area Comum', 'Modificar configuracoes do medidor de energia da area comum', 'medium');

    -- Energy > Hidrometro > Stores
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'energy', 'hidrometro', 'stores', 'read', 'Leitura Medidor Energia Lojas', 'Ver dados do medidor de energia das lojas', 'low'),
        (NULL, 'energy', 'hidrometro', 'stores', 'update', 'Atualizar Medidor Energia Lojas', 'Modificar configuracoes do medidor de energia das lojas', 'medium');

    -- Energy > Temperature > Internal
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'energy', 'temperature', 'internal', 'read', 'Leitura Temperatura Interna', 'Ver dados de temperatura interna', 'low'),
        (NULL, 'energy', 'temperature', 'internal', 'update', 'Atualizar Temperatura Interna', 'Modificar configuracoes de temperatura interna', 'medium');

    -- Energy > Temperature > External
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'energy', 'temperature', 'external', 'read', 'Leitura Temperatura Externa', 'Ver dados de temperatura externa', 'low'),
        (NULL, 'energy', 'temperature', 'external', 'update', 'Atualizar Temperatura Externa', 'Modificar configuracoes de temperatura externa', 'medium');

    -- =========================================================================
    -- GAS DOMAIN
    -- =========================================================================

    -- Gas > Medidor > Entry
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'gas', 'medidor', 'entry', 'read', 'Leitura Medidor Gas Entrada', 'Ver dados do medidor de gas da entrada', 'low'),
        (NULL, 'gas', 'medidor', 'entry', 'update', 'Atualizar Medidor Gas Entrada', 'Modificar configuracoes do medidor de gas da entrada', 'medium');

    -- Gas > Medidor > Kitchen
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'gas', 'medidor', 'kitchen', 'read', 'Leitura Medidor Gas Cozinha', 'Ver dados do medidor de gas da cozinha', 'low'),
        (NULL, 'gas', 'medidor', 'kitchen', 'update', 'Atualizar Medidor Gas Cozinha', 'Modificar configuracoes do medidor de gas da cozinha', 'medium');

    -- =========================================================================
    -- HVAC DOMAIN (Heating, Ventilation, Air Conditioning)
    -- =========================================================================

    -- HVAC > Controlador > Stores
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'hvac', 'controlador', 'stores', 'read', 'Leitura Controlador HVAC Lojas', 'Ver dados do controlador HVAC das lojas', 'low'),
        (NULL, 'hvac', 'controlador', 'stores', 'update', 'Atualizar Controlador HVAC Lojas', 'Modificar configuracoes do controlador HVAC das lojas', 'high');

    -- HVAC > Controlador > Common Area
    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'hvac', 'controlador', 'common_area', 'read', 'Leitura Controlador HVAC Area Comum', 'Ver dados do controlador HVAC da area comum', 'low'),
        (NULL, 'hvac', 'controlador', 'common_area', 'update', 'Atualizar Controlador HVAC Area Comum', 'Modificar configuracoes do controlador HVAC da area comum', 'high');

    -- =========================================================================
    -- FEATURE PERMISSIONS (for dashboard access)
    -- =========================================================================

    INSERT INTO domain_permissions (tenant_id, domain, equipment, location, action, display_name, description, risk_level)
    VALUES
        (NULL, 'dashboards', 'operational', 'indicators', 'read', 'Dashboard Indicadores Operacionais', 'Acesso ao dashboard de indicadores operacionais', 'low'),
        (NULL, 'dashboards', 'head_office', 'overview', 'read', 'Dashboard Sede', 'Acesso ao dashboard da sede', 'low'),
        (NULL, 'reports', 'export', 'all', 'execute', 'Exportar Relatorios', 'Permissao para exportar relatorios', 'medium');

    RAISE NOTICE 'Inserted domain permissions for RFC-0013';
END $$;

-- Verify
SELECT domain, equipment, location, action, display_name, risk_level
FROM domain_permissions
ORDER BY domain, equipment, location, action;
