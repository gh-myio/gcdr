-- =============================================================================
-- OPS (LOCAL TEST): OS test users — technician + OS-only
-- =============================================================================
-- Idempotent & self-contained. Creates two test users so you can log in and
-- exercise the OS-restriction features:
--
--   1. tecnico@teste.local   role:technician  → on a Work Order detail the
--      "Equipe Técnica", "Aprovador MYIO" and "Aprovador Cliente" cards are
--      hidden.
--   2. os.only@teste.local   role:os-only     → the sidebar shows only the OS
--      item and every non-/os route redirects to /os.
--
-- Both are scoped to customer 77777777… which already has seeded Work Orders
-- (e.g. OS-MNT2K7) so the OS detail page has something to open.
--
-- Password for BOTH: Test123!   (same SHA256 hash used by scripts/db/seeds/03-users.sql)
--
-- Run (local Docker):
--   $env:DB_CONTAINER="gcdr-db-local"; npm run db:ops -- scripts/db/ops/seed-local-test-users-os.sql
--
-- role:technician is already seeded (05-roles.sql). role:os-only +
-- policy:work-orders-only are ensured here too, so this script needs no
-- prerequisites.
-- =============================================================================

DO $$
DECLARE
    v_tenant_id     UUID := '11111111-1111-1111-1111-111111111111';
    -- Customer that owns the seeded Work Orders. Change if you scope elsewhere.
    v_customer_id   UUID := '77777777-7777-7777-7777-777777777777';
    v_admin_id      UUID := 'bbbb1111-1111-1111-1111-111111111111';
    v_password_hash TEXT := '54de7f606f2523cba8efac173fab42fb7f59d56ceff974c8fdb7342cf2cfe345'; -- Test123!
    v_tech_id       UUID := 'bbbb0a01-0a01-0a01-0a01-000000000a01';
    v_osonly_id     UUID := 'bbbb0a02-0a02-0a02-0a02-000000000a02';
BEGIN
    -- ── Ensure the OS-only policy + role exist (technician role is seeded) ──────
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc1212-1212-1212-1212-121212121212', v_tenant_id, 'policy:work-orders-only',
        'Work Orders Only', 'Access limited to the OS (Work Orders) domain; no other domain is granted',
        '["workorders.*.*"]', '[]', 'low', true, 1
    ) ON CONFLICT DO NOTHING;

    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd1212-1212-1212-1212-121212121212', v_tenant_id, 'role:os-only',
        'OS Only', 'Access restricted to the OS (Work Orders) area only; no other menus or routes',
        '["policy:work-orders-only"]', '["os", "workorders", "restricted"]', 'low', true, 1
    ) ON CONFLICT DO NOTHING;

    -- ── Test user 1: TECHNICIAN ────────────────────────────────────────────────
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        v_tech_id, v_tenant_id, v_customer_id, 'tecnico@teste.local', true, 'tecnico', 'CUSTOMER', 'ACTIVE',
        '{"firstName": "Téo", "lastName": "Técnico", "displayName": "Téo Técnico (teste)", "jobTitle": "Field Technician"}',
        jsonb_build_object('mfaEnabled', false, 'mfaMethod', null, 'lastLoginAt', null, 'failedLoginAttempts', 0, 'passwordHash', v_password_hash),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo", "dateFormat": "DD/MM/YYYY", "theme": "light"}',
        '["test", "technician"]', 1
    ) ON CONFLICT DO NOTHING;

    -- ── Test user 2: OS-ONLY ───────────────────────────────────────────────────
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        v_osonly_id, v_tenant_id, v_customer_id, 'os.only@teste.local', true, 'os.only', 'CUSTOMER', 'ACTIVE',
        '{"firstName": "Ozzy", "lastName": "OnlyOS", "displayName": "Ozzy OnlyOS (teste)", "jobTitle": "OS Operator"}',
        jsonb_build_object('mfaEnabled', false, 'mfaMethod', null, 'lastLoginAt', null, 'failedLoginAttempts', 0, 'passwordHash', v_password_hash),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo", "dateFormat": "DD/MM/YYYY", "theme": "light"}',
        '["test", "os-only"]', 1
    ) ON CONFLICT DO NOTHING;

    -- ── Assignments (customer-scoped) ──────────────────────────────────────────
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee0a01-0a01-0a01-0a01-000000000a01', v_tenant_id, v_tech_id, 'role:technician',
        'customer:' || v_customer_id, 'active', v_admin_id, NOW(), 'Local test technician', 1
    ) ON CONFLICT DO NOTHING;

    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        'eeee0a02-0a02-0a02-0a02-000000000a02', v_tenant_id, v_osonly_id, 'role:os-only',
        'customer:' || v_customer_id, 'active', v_admin_id, NOW(), 'Local test OS-only user', 1
    ) ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Test users ready: tecnico@teste.local (role:technician), os.only@teste.local (role:os-only) — password Test123!';
END $$;

-- Verify
SELECT u.email, u.username, u.status, ra.role_key, ra.scope, ra.status AS assignment_status
FROM users u
JOIN role_assignments ra ON ra.user_id = u.id
WHERE u.email IN ('tecnico@teste.local', 'os.only@teste.local')
ORDER BY u.email;
