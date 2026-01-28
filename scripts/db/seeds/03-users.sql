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

    -- RFC-0011: Unverified User (email not yet verified)
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, metadata, version)
    VALUES (
        'bbbb6666-6666-6666-6666-666666666666',
        v_tenant_id,
        v_company1_id,
        'unverified@acmetech.com',
        false,
        NULL,
        'CUSTOMER',
        'UNVERIFIED',
        '{"firstName": "Unverified", "lastName": "User", "displayName": "Unverified User"}',
        jsonb_build_object('mfaEnabled', false, 'failedLoginAttempts', 0, 'lockoutCount', 0, 'passwordHash', v_password_hash, 'registeredAt', NOW()::text, 'registrationIp', '192.168.1.100'),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo"}',
        '[]',
        '{"selfRegistered": true}',
        1
    );

    -- RFC-0011: Pending Approval User (email verified, awaiting admin approval)
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, metadata, version)
    VALUES (
        'bbbb7777-7777-7777-7777-777777777777',
        v_tenant_id,
        v_company1_id,
        'pending@acmetech.com',
        true,
        NULL,
        'CUSTOMER',
        'PENDING_APPROVAL',
        '{"firstName": "Pending", "lastName": "Approval", "displayName": "Pending Approval"}',
        jsonb_build_object('mfaEnabled', false, 'failedLoginAttempts', 0, 'lockoutCount', 0, 'passwordHash', v_password_hash, 'registeredAt', (NOW() - INTERVAL '1 day')::text, 'emailVerifiedAt', NOW()::text),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo"}',
        '[]',
        '{"selfRegistered": true}',
        1
    );

    -- RFC-0011: Locked User (account locked due to failed login attempts)
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        'bbbb8888-8888-8888-8888-888888888888',
        v_tenant_id,
        v_company1_id,
        'locked@acmetech.com',
        true,
        'locked.user',
        'CUSTOMER',
        'LOCKED',
        '{"firstName": "Locked", "lastName": "User", "displayName": "Locked User"}',
        jsonb_build_object('mfaEnabled', false, 'failedLoginAttempts', 6, 'lockoutCount', 1, 'passwordHash', v_password_hash, 'lockedAt', NOW()::text, 'lockedReason', 'Conta bloqueada após 6 tentativas de login incorretas'),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo"}',
        '[]',
        1
    );

    RAISE NOTICE 'Inserted 8 users';
END $$;

-- Verify
SELECT id, email, username, type, status FROM users ORDER BY type, email;
