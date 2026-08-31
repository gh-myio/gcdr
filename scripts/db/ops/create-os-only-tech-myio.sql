-- =============================================================================
-- OPS (PROD): técnico do customer Myio com perfil "ver apenas as OS"
-- =============================================================================
-- Cria 1 usuário CUSTOMER no customer Myio (56614a70-326f-11ef-ad2c-53aeabe7d3fa)
-- com role:os-only escopado ao customer: o frontend mostra SOMENTE o menu OS e
-- redireciona qualquer outra rota para /os; o policy server-side limita o
-- acesso a workorders.*.* (nenhum outro domínio).
--
-- Login:  tecnico.myio@myio.com.br
-- Senha:  OsMyio@2026        (hash SHA-256 abaixo — troque no primeiro acesso)
--
-- Idempotente (ON CONFLICT DO NOTHING). Garante policy/role os-only antes
-- (mesmos ids fixos dos seeds — no-op se já existem).
-- Modelo: scripts/db/ops/seed-local-test-users-os.sql
-- =============================================================================

DO $$
DECLARE
    v_tenant_id     UUID := '11111111-1111-1111-1111-111111111111';
    v_customer_id   UUID := '56614a70-326f-11ef-ad2c-53aeabe7d3fa';  -- Myio
    v_user_id       UUID := 'bbbb0a10-0a10-0a10-0a10-000000000a10';
    v_assign_id     UUID := 'eeee0a10-0a10-0a10-0a10-000000000a10';
    v_admin_id      UUID := 'bbbb1111-1111-1111-1111-111111111111';  -- seed admin (granted_by)
    -- SHA-256 de 'OsMyio@2026'
    v_password_hash TEXT := '9f53263534f0704b126ea902087049a1080842324ebab724045e7d46d917c74b';
BEGIN
    -- ── Garante policy + role os-only (no-op se seeds já rodaram) ─────────────
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

    -- ── Usuário técnico (Myio) ────────────────────────────────────────────────
    INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
    VALUES (
        v_user_id, v_tenant_id, v_customer_id,
        'tecnico.myio@myio.com.br', true, 'tecnico.myio', 'CUSTOMER', 'ACTIVE',
        '{"firstName": "Técnico", "lastName": "Myio", "displayName": "Técnico Myio", "jobTitle": "Field Technician"}',
        jsonb_build_object('mfaEnabled', false, 'mfaMethod', null, 'lastLoginAt', null, 'failedLoginAttempts', 0, 'passwordHash', v_password_hash),
        '{"language": "pt-BR", "timezone": "America/Sao_Paulo", "dateFormat": "DD/MM/YYYY", "theme": "light"}',
        '["technician", "os-only"]', 1
    ) ON CONFLICT DO NOTHING;

    -- ── Assignment os-only escopado ao customer Myio ──────────────────────────
    INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
    VALUES (
        v_assign_id, v_tenant_id, v_user_id, 'role:os-only',
        'customer:' || v_customer_id, 'active', v_admin_id, NOW(),
        'Técnico Myio — acesso restrito às OS', 1
    ) ON CONFLICT DO NOTHING;
END $$;

-- Conferência
SELECT u.email, u.status, ra.role_key, ra.scope
FROM users u JOIN role_assignments ra ON ra.user_id = u.id
WHERE u.id = 'bbbb0a10-0a10-0a10-0a10-000000000a10';
