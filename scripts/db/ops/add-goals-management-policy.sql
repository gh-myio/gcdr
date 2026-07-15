-- =============================================================================
-- OPS: policy:goals-management (RFC-0046 feedback P0.1) — idempotent.
--
-- The goals routes now enforce RBAC for JWT users (requireGoalsAccess):
--   GET                    → goals.goal.read
--   PUT/PATCH/POST/DELETE  → goals.goal.update
--
-- Roles backed by policy:full-admin (*.*.*) keep full access and read-only
-- (*.*.read) keeps read access with no changes. Any other role that must keep
-- using the goals UI needs this policy appended.
--
-- Run per tenant (edit v_tenant_id) with:
--   psql "$DATABASE_URL" -f scripts/db/ops/add-goals-management-policy.sql
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        gen_random_uuid(),
        v_tenant_id,
        'policy:goals-management',
        'Consumption Goals Management',
        'Read and edit customer consumption goals (RFC-0046), including margin and CSV import',
        '["goals.goal.read", "goals.goal.update"]',
        '[]',
        'medium',
        false,
        1
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

    -- Append the policy to the operator roles that own goals today.
    UPDATE roles
    SET policies = policies || '["policy:goals-management"]'::jsonb,
        version = version + 1
    WHERE tenant_id = v_tenant_id
      AND key IN ('role:customer-admin', 'role:energy-analyst')
      AND NOT policies @> '["policy:goals-management"]'::jsonb;

    RAISE NOTICE 'policy:goals-management ensured for tenant %', v_tenant_id;
END $$;

-- Verify
SELECT key, allow FROM policies WHERE key = 'policy:goals-management';
SELECT key, policies FROM roles WHERE key IN ('role:customer-admin', 'role:energy-analyst');
