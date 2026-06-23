-- =============================================================================
-- OPS: add policy:work-orders-only + role:os-only  (OS-only restricted user)
-- =============================================================================
-- Idempotent. Adds the least-privilege OS (Work Orders) policy and role to an
-- already-seeded database (local/prod). On fresh installs the same records come
-- from scripts/db/seeds/04-policies.sql and 05-roles.sql.
--
-- The frontend confines a user carrying role:os-only to the /os area (sidebar
-- shows only OS; every other route redirects to /os). Backend /wo/* stays
-- auth-only by design, so this role's permissions are advisory + drive the
-- frontend gating and /auth/me effectivePermissions.
--
-- Usage (local Docker):
--   $env:DB_CONTAINER="gcdr-db-local"; npm run db:ops -- scripts/db/ops/add-os-only-role.sql
-- or pipe straight into psql.
--
-- After running, assign it to a user (customer-scoped) via the API:
--   POST /api/v1/authorization/assignments
--   { "userId": "<uuid>", "roleKey": "role:os-only", "scope": "customer:<uuid>" }
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    -- Policy: access confined to the OS (Work Orders) domain.
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cccc1212-1212-1212-1212-121212121212',
        v_tenant_id,
        'policy:work-orders-only',
        'Work Orders Only',
        'Access limited to the OS (Work Orders) domain; no other domain is granted',
        '["workorders.*.*"]',
        '[]',
        'low',
        true,
        1
    )
    ON CONFLICT DO NOTHING;

    -- Role: references the policy above.
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dddd1212-1212-1212-1212-121212121212',
        v_tenant_id,
        'role:os-only',
        'OS Only',
        'Access restricted to the OS (Work Orders) area only; no other menus or routes',
        '["policy:work-orders-only"]',
        '["os", "workorders", "restricted"]',
        'low',
        true,
        1
    )
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'OS-only policy/role ensured (policy:work-orders-only, role:os-only)';
END $$;

-- Verify
SELECT key, display_name FROM policies WHERE key = 'policy:work-orders-only';
SELECT key, display_name, policies FROM roles WHERE key = 'role:os-only';
