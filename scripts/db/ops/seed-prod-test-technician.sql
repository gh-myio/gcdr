-- =============================================================================
-- OPS (PROD): create a TEST technician user
-- =============================================================================
-- Idempotent (ON CONFLICT DO NOTHING). Creates one test technician and assigns a
-- role scoped to a customer, so you can log in and exercise the restricted
-- technician OS experience in production.
--
-- ROLE CHOICE — this matters:
--   • role:os-only   → CONFINES the user to the OS area: the sidebar shows only
--                      OS and every non-/os route redirects to /os. This is what
--                      you want for a technician who should "only see OS".
--                      Requires scripts/db/ops/add-os-only-role.sql to have run
--                      first (creates policy:work-orders-only + role:os-only).
--   • role:technician → only restricts the WORK-ORDER DETAIL UI; the user still
--                      sees the full menu and can reach every route. NOT confined.
--
-- ⚠️  BEFORE RUNNING:
--     1. Run scripts/db/ops/add-os-only-role.sql once (so role:os-only exists).
--     2. Set v_customer_id to a REAL prod customer id (the script aborts otherwise).
--     3. Confirm v_tenant_id matches your prod tenant (default MYIO tenant below).
--
-- Login password for the created user: Test123!
-- Change it after first login (or edit v_password_hash to your own SHA-256 hash).
--
-- Run (prod):
--   psql "<PROD_DATABASE_URL>" -f scripts/db/ops/seed-prod-test-technician.sql
-- =============================================================================

DO $$
DECLARE
    v_tenant_id     UUID := '11111111-1111-1111-1111-111111111111'; -- confirm prod tenant
    v_customer_id   UUID := '56614a70-326f-11ef-ad2c-53aeabe7d3fa'; -- ⚠️ SET a real prod customer id
    v_role_key      TEXT := 'role:os-only';                         -- confines to OS; or 'role:technician' (full menu)
    -- Distinct ids from the local-only seed (seed-local-test-users-os.sql) so the
    -- two never collide if both are ever applied to the same database.
    v_tech_id       UUID := 'bbbb0b01-0b01-0b01-0b01-000000000b01';
    v_assignment_id UUID := 'eeee0b01-0b01-0b01-0b01-000000000b01';
    v_password_hash TEXT := '54de7f606f2523cba8efac173fab42fb7f59d56ceff974c8fdb7342cf2cfe345'; -- Test123!
BEGIN
    -- Guard against running with the placeholder customer.
    IF v_customer_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
        RAISE EXCEPTION 'Set v_customer_id to a real prod customer id before running this script.';
    END IF;

    -- Fail fast on a typo'd customer / wrong tenant.
    IF NOT EXISTS (
        SELECT 1 FROM customers WHERE id = v_customer_id AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'Customer % not found in tenant %.', v_customer_id, v_tenant_id;
    END IF;

    -- Ensure the chosen role exists in this tenant.
    IF NOT EXISTS (
        SELECT 1 FROM roles WHERE key = v_role_key AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'Role % not found in tenant % (run add-os-only-role.sql first for role:os-only).', v_role_key, v_tenant_id;
    END IF;

    -- ── Test technician user ────────────────────────────────────────────────
    INSERT INTO users (
        id, tenant_id, customer_id, email, email_verified, username, type, status,
        profile, security, preferences, tags, version
    )
    VALUES (
        v_tech_id, v_tenant_id, v_customer_id, 'tecnico.teste@myio-bas.com', true,
        'tecnico.teste', 'CUSTOMER', 'ACTIVE',
        '{"firstName": "Tecnico", "lastName": "Teste", "displayName": "Tecnico Teste (teste)", "jobTitle": "Field Technician"}',
        jsonb_build_object(
            'mfaEnabled', false, 'mfaMethod', null, 'lastLoginAt', null,
            'failedLoginAttempts', 0, 'passwordHash', v_password_hash
        ),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo", "dateFormat": "DD/MM/YYYY", "theme": "light"}',
        '["test", "technician"]', 1
    ) ON CONFLICT DO NOTHING;

    -- ── Role assignment (customer-scoped) ───────────────────────────────────
    -- granted_by has no FK constraint; self-reference the test user so we don't
    -- depend on a specific prod admin id.
    INSERT INTO role_assignments (
        id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version
    )
    VALUES (
        v_assignment_id, v_tenant_id, v_tech_id, v_role_key,
        'customer:' || v_customer_id, 'active', v_tech_id, NOW(),
        'Prod test technician', 1
    ) ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Prod test technician ready: tecnico.teste@myio-bas.com (% @ customer %) — password Test123!',
        v_role_key, v_customer_id;
END $$;

-- Verify
SELECT u.email, u.username, u.status, ra.role_key, ra.scope, ra.status AS assignment_status
FROM users u
JOIN role_assignments ra ON ra.user_id = u.id
WHERE u.id = 'bbbb0b01-0b01-0b01-0b01-000000000b01';
