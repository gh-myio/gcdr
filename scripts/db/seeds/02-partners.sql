-- =============================================================================
-- SEED: PARTNERS
-- =============================================================================
-- Mock data for partners table
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_partner1_id UUID := 'aaaa1111-1111-1111-1111-111111111111';
    v_partner2_id UUID := 'aaaa2222-2222-2222-2222-222222222222';
    v_partner3_id UUID := 'aaaa3333-3333-3333-3333-333333333333';
BEGIN
    -- Partner 1: Approved and Active
    INSERT INTO partners (id, tenant_id, status, company_name, company_website, company_description, industry, country, contact_name, contact_email, contact_phone, technical_contact_email, webhook_url, scopes, rate_limit_per_minute, rate_limit_per_day, monthly_quota, approved_at, activated_at, version)
    VALUES (
        v_partner1_id,
        v_tenant_id,
        'ACTIVE',
        'TechPartner Solutions',
        'https://techpartner.com',
        'Leading IoT integration partner specializing in industrial solutions',
        'Technology',
        'Brazil',
        'João Silva',
        'joao@techpartner.com',
        '+55 11 99999-0001',
        'tech@techpartner.com',
        'https://techpartner.com/webhooks/gcdr',
        '["devices:read", "devices:write", "telemetry:read", "alerts:read"]',
        200,
        20000,
        500000,
        NOW() - INTERVAL '30 days',
        NOW() - INTERVAL '25 days',
        1
    );

    -- Partner 2: Pending Approval
    INSERT INTO partners (id, tenant_id, status, company_name, company_website, company_description, industry, country, contact_name, contact_email, contact_phone, technical_contact_email, scopes, version)
    VALUES (
        v_partner2_id,
        v_tenant_id,
        'PENDING',
        'DataFlow Analytics',
        'https://dataflow.io',
        'Data analytics platform for IoT and industrial data',
        'Analytics',
        'USA',
        'John Smith',
        'john@dataflow.io',
        '+1 555-0002',
        'developers@dataflow.io',
        '["telemetry:read", "reports:read"]',
        1
    );

    -- Partner 3: Suspended
    INSERT INTO partners (id, tenant_id, status, company_name, company_website, company_description, industry, country, contact_name, contact_email, contact_phone, technical_contact_email, scopes, suspended_at, suspension_reason, version)
    VALUES (
        v_partner3_id,
        v_tenant_id,
        'SUSPENDED',
        'OldTech Corp',
        'https://oldtech.com',
        'Legacy system integration services',
        'Technology',
        'Brazil',
        'Maria Santos',
        'maria@oldtech.com',
        '+55 11 99999-0003',
        'dev@oldtech.com',
        '["devices:read"]',
        NOW() - INTERVAL '7 days',
        'API rate limit violations',
        1
    );

    RAISE NOTICE 'Inserted 3 partners';
END $$;

-- Verify
SELECT id, company_name, status, industry, country FROM partners ORDER BY company_name;
