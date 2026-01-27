-- =============================================================================
-- SEED: USERS
-- =============================================================================
-- Mock data for users table
-- Password for all test users: Test123!
-- SHA256 hash: 54de7f606f2523cba8efac173fab42fb7f59d56ceff974c8fdb7342cf2cfe345
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
    v_holding_id UUID := '22222222-2222-2222-2222-222222222222';
    v_company1_id UUID := '33333333-3333-3333-3333-333333333333';
    v_partner1_id UUID := 'aaaa1111-1111-1111-1111-111111111111';
    v_password_hash TEXT := '54de7f606f2523cba8efac173fab42fb7f59d56ceff974c8fdb7342cf2cfe345';
BEGIN
    -- Admin User (Internal)
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        'bbbb1111-1111-1111-1111-111111111111',
        v_tenant_id,
        v_holding_id,
        'admin@gcdr.io',
        true,
        'admin',
        'INTERNAL',
        'ACTIVE',
        '{"firstName": "System", "lastName": "Administrator", "displayName": "Admin", "phone": "+55 11 99999-9999", "avatar": null}',
        jsonb_build_object('mfaEnabled', false, 'mfaMethod', null, 'lastLoginAt', null, 'failedLoginAttempts', 0, 'passwordHash', v_password_hash),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo", "dateFormat": "DD/MM/YYYY", "theme": "light", "notifications": {"email": true, "push": true, "sms": false}}',
        '["admin", "super-user"]',
        1
    );

    -- Customer User 1
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        'bbbb2222-2222-2222-2222-222222222222',
        v_tenant_id,
        v_company1_id,
        'joao.silva@acmetech.com',
        true,
        'joao.silva',
        'CUSTOMER',
        'ACTIVE',
        '{"firstName": "João", "lastName": "Silva", "displayName": "João Silva", "phone": "+55 11 98888-0001", "jobTitle": "Operations Manager"}',
        jsonb_build_object('mfaEnabled', false, 'lastLoginAt', null, 'failedLoginAttempts', 0, 'passwordHash', v_password_hash),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo", "dateFormat": "DD/MM/YYYY", "theme": "light"}',
        '["operations", "manager"]',
        1
    );

    -- Customer User 2
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        'bbbb3333-3333-3333-3333-333333333333',
        v_tenant_id,
        v_company1_id,
        'maria.santos@acmetech.com',
        true,
        'maria.santos',
        'CUSTOMER',
        'ACTIVE',
        '{"firstName": "Maria", "lastName": "Santos", "displayName": "Maria Santos", "phone": "+55 11 98888-0002", "jobTitle": "Technical Lead"}',
        jsonb_build_object('mfaEnabled', false, 'mfaMethod', null, 'lastLoginAt', null, 'failedLoginAttempts', 0, 'passwordHash', v_password_hash),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo", "dateFormat": "DD/MM/YYYY", "theme": "dark"}',
        '["technical", "lead"]',
        1
    );

    -- Partner User
    INSERT INTO users (id, tenant_id, partner_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        'bbbb4444-4444-4444-4444-444444444444',
        v_tenant_id,
        v_partner1_id,
        'dev@techpartner.com',
        true,
        'techpartner.dev',
        'PARTNER',
        'ACTIVE',
        '{"firstName": "Developer", "lastName": "TechPartner", "displayName": "TechPartner Dev", "phone": "+55 11 98888-0003"}',
        jsonb_build_object('mfaEnabled', false, 'lastLoginAt', null, 'failedLoginAttempts', 0, 'passwordHash', v_password_hash),
        '{"language": "en-US", "timezone": "America/Sao_Paulo", "dateFormat": "MM/DD/YYYY", "theme": "light"}',
        '["partner", "developer"]',
        1
    );

    -- Service Account
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        'bbbb5555-5555-5555-5555-555555555555',
        v_tenant_id,
        v_holding_id,
        'service@gcdr.io',
        true,
        'service-account',
        'SERVICE_ACCOUNT',
        'ACTIVE',
        '{"firstName": "Service", "lastName": "Account", "displayName": "Integration Service"}',
        jsonb_build_object('mfaEnabled', false, 'passwordHash', v_password_hash),
        '{"language": "en-US", "timezone": "UTC"}',
        '["service", "integration"]',
        1
    );

    -- Pending User
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, invited_by, invited_at, tags, version)
    VALUES (
        'bbbb6666-6666-6666-6666-666666666666',
        v_tenant_id,
        v_company1_id,
        'newuser@acmetech.com',
        false,
        NULL,
        'CUSTOMER',
        'PENDING_VERIFICATION',
        '{"firstName": "New", "lastName": "User", "displayName": "New User"}',
        jsonb_build_object('mfaEnabled', false, 'failedLoginAttempts', 0, 'passwordHash', v_password_hash),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo"}',
        'bbbb1111-1111-1111-1111-111111111111',
        NOW(),
        '[]',
        1
    );

    RAISE NOTICE 'Inserted 6 users';
END $$;

-- Verify
SELECT id, email, username, type, status FROM users ORDER BY type, email;
