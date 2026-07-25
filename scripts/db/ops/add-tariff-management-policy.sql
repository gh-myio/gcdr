-- =============================================================================
-- OPS: policy:tariff-management (RFC-0054 Phase 1) — idempotent.
--
-- The tariff routes enforce RBAC for JWT users (requireTariffAccess):
--   GET                  → tariffs.tariff.read
--   PUT/PATCH/DELETE      → tariffs.tariff.update
--
-- Roles backed by policy:full-admin (*.*.*) keep full access and read-only
-- (*.*.read) keeps read access with no changes. Any other role that must
-- manage tariffs needs this policy appended. RFC-0222's @myio.com.br /
-- SuperAdmin gate remains a deployment policy on top.
--
-- Run per tenant (edit v_tenant_id) with:
--   psql "$DATABASE_URL" -f scripts/db/ops/add-tariff-management-policy.sql
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        gen_random_uuid(),
        v_tenant_id,
        'policy:tariff-management',
        'Customer Tariff Management',
        'Read and edit customer hourly tariffs (RFC-0054): R$/kWh and R$/m3 per category',
        '["tariffs.tariff.read", "tariffs.tariff.update"]',
        '[]',
        'medium',
        false,
        1
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

    UPDATE roles
    SET policies = policies || '["policy:tariff-management"]'::jsonb,
        version = version + 1
    WHERE tenant_id = v_tenant_id
      AND key IN ('role:customer-admin', 'role:energy-analyst')
      AND NOT policies @> '["policy:tariff-management"]'::jsonb;

    RAISE NOTICE 'policy:tariff-management ensured for tenant %', v_tenant_id;
END $$;

-- Verify
SELECT key, allow FROM policies WHERE key = 'policy:tariff-management';
SELECT key, policies FROM roles WHERE key IN ('role:customer-admin', 'role:energy-analyst');
