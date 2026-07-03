-- Migration 0056: RFC-0050 — Pre-Setup Operator role (phase B1)
--
-- Seeds the RBAC role `role:presetup-operator` for every tenant that already
-- has RBAC roles (plus the default tenant), so presetup operators stop needing
-- role:super-admin or the master API key. Idempotent via the
-- roles_tenant_key_unique index — safe to re-run.
--
-- The policy set covers the presetup's full surface: customer create/update,
-- asset CRUD, central CRUD (+ MQTT credentials, RFC-0035), device CRUD + move,
-- customer API keys (RFC-0036), integrations ledger writes (RFC-0033), and
-- Work Orders (RFC-0037). Assignment to users is per-tenant configuration,
-- not part of this migration.

INSERT INTO roles (tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
SELECT
    t.tenant_id,
    'role:presetup-operator',
    'Pre-Setup Operator',
    'Provisions customer topology before go-live: customers, assets, centrals, devices, API keys, integration sync state and work orders. Grants access to the integrations proxy (RFC-0050).',
    '["policy:customer-management", "policy:device-management", "policy:integration-management", "policy:work-orders-only", "policy:reports"]'::jsonb,
    '["presetup", "operator", "provisioning"]'::jsonb,
    'high',
    true,
    1
FROM (
    SELECT DISTINCT tenant_id FROM roles
    UNION
    SELECT '11111111-1111-1111-1111-111111111111'::uuid
) t
ON CONFLICT (tenant_id, key) DO NOTHING;
