-- =============================================================================
-- RFC-0053 — Single Dashboard viewer (asset-scoped) — idempotent ops script
--
-- Creates:
--   policy:single-dashboard-only  allow: dashboard.single.read + annotations
--                                 read/create + tickets read/create
--   role:single-dashboard-viewer  (isSystem)
--   pilot user  loja.q303a@myio.com.br  (password: Loja@2026)
--   assignment  scope 'customer:<moxuara>/asset:<Q303A_L3>'
--   demo devices (energy/water/temperature) on asset SCMOXUARAQ303A_L3
--
-- Enforcement (backend):
--   - middleware/auth.ts: JWT users whose only role is
--     role:single-dashboard-viewer are locked to the allowlist
--     (auth, single-dashboard, annotations, wo/tickets, device read).
--   - middleware/requireDashboardPermission.ts: RBAC engine evaluates
--     dashboard.single.read against customer/asset scopes and auto-narrows
--     single-asset grants.
--
-- Usage (local):  docker exec -i gcdr-db-local psql -U postgres -d db_gcdr \
--                   < scripts/db/ops/add-single-dashboard-viewer-role.sql
-- =============================================================================

DO $$
DECLARE
  v_tenant_id   uuid := '11111111-1111-1111-1111-111111111111';
  v_customer_id uuid := '84e0370e-636a-4741-9874-504b5e0b3577'; -- Moxuara
  v_asset_id    uuid := '1de09bd4-7871-44b6-bd6d-3c0b4ca0b349'; -- SCMOXUARAQ303A_L3
  v_admin_id    uuid;
  v_user_id     uuid := 'ab303a00-0000-4000-8000-000000000001';
BEGIN
  SELECT id INTO v_admin_id FROM users WHERE tenant_id = v_tenant_id ORDER BY created_at LIMIT 1;

  -- ── Policy ──────────────────────────────────────────────────────────────
  INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
  VALUES (
    'cccc5300-0000-4000-8000-000000000001', v_tenant_id,
    'policy:single-dashboard-only', 'Single Dashboard Only',
    'RFC-0053: read the single-customer dashboard of the granted scope, plus annotations and tickets collaboration',
    '["dashboard.single.read", "annotations.annotation.read", "annotations.annotation.create", "workorders.ticket.read", "workorders.ticket.create", "devices.device.read"]',
    '[]',
    'low', true, 1
  )
  ON CONFLICT DO NOTHING;

  -- ── Role ────────────────────────────────────────────────────────────────
  INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
  VALUES (
    'dddd5300-0000-4000-8000-000000000001', v_tenant_id,
    'role:single-dashboard-viewer', 'Single Dashboard Viewer',
    'RFC-0053: store user confined to the Single Dashboard of the assigned customer/asset scope',
    '["policy:single-dashboard-only"]',
    '["single-dashboard", "viewer", "store"]',
    'low', true, 1
  )
  ON CONFLICT DO NOTHING;

  -- ── Pilot user (password: Loja@2026 — sha256 hex, same scheme as seeds) ─
  INSERT INTO users (id, tenant_id, customer_id, email, email_verified, username, type, status, profile, security, preferences, tags, version)
  VALUES (
    v_user_id, v_tenant_id, v_customer_id,
    'loja.q303a@myio.com.br', true, 'loja.q303a', 'INTERNAL', 'ACTIVE',
    '{"firstName": "Loja", "lastName": "Q303A", "displayName": "Loja Q303A", "phone": null, "avatar": null}',
    jsonb_build_object('mfaEnabled', false, 'mfaMethod', null, 'lastLoginAt', null, 'failedLoginAttempts', 0,
      'passwordHash', '1dfb345e0bf02b64ee1749622227f0fae772b0084726b6ad72f94443da9310a3'),
    '{"language": "pt-BR", "timezone": "America/Sao_Paulo", "theme": "light"}',
    '["single-dashboard"]', 1
  )
  ON CONFLICT DO NOTHING;

  -- ── Assignment (hierarchical customer/asset scope) ──────────────────────
  INSERT INTO role_assignments (id, tenant_id, user_id, role_key, scope, status, granted_by, granted_at, reason, version)
  VALUES (
    'eeee5300-0000-4000-8000-000000000001', v_tenant_id, v_user_id,
    'role:single-dashboard-viewer',
    'customer:' || v_customer_id || '/asset:' || v_asset_id,
    'active', COALESCE(v_admin_id, v_user_id), NOW(),
    'RFC-0053 pilot: Single Dashboard scoped to asset SCMOXUARAQ303A_L3', 1
  )
  ON CONFLICT DO NOTHING;

  -- ── Demo devices on the asset (energy / water / temperature) ────────────
  INSERT INTO devices (id, tenant_id, customer_id, asset_id, type, name, display_name, label, identifier, serial_number, device_type, device_profile, status, connectivity_status, created_at, updated_at)
  VALUES
    ('de303a00-0000-4000-8000-000000000001', v_tenant_id, v_customer_id, v_asset_id, 'METER',
     'Q303A Medidor Energia', 'Medidor de Energia', 'Medidor de Energia', 'Q303A_ENERGIA', 'SN-Q303A-001', '3F_MEDIDOR', '3F_MEDIDOR', 'ACTIVE', 'ONLINE', NOW(), NOW()),
    ('de303a00-0000-4000-8000-000000000002', v_tenant_id, v_customer_id, v_asset_id, 'METER',
     'Q303A Ar-Condicionado', 'Ar-Condicionado', 'Ar-Condicionado', 'Q303A_HVAC', 'SN-Q303A-002', 'AR_CONDICIONADO', 'HVAC', 'ACTIVE', 'ONLINE', NOW(), NOW()),
    ('de303a00-0000-4000-8000-000000000003', v_tenant_id, v_customer_id, v_asset_id, 'METER',
     'Q303A Hidrometro', 'Hidrômetro', 'Hidrômetro', 'Q303A_HIDRO', 'SN-Q303A-003', 'HIDROMETRO', 'HIDROMETRO', 'ACTIVE', 'ONLINE', NOW(), NOW()),
    ('de303a00-0000-4000-8000-000000000004', v_tenant_id, v_customer_id, v_asset_id, 'METER',
     'Q303A Caixa Dagua', 'Caixa d''Água', 'Caixa d''Água', 'Q303A_CAIXA', 'SN-Q303A-004', 'CAIXA_DAGUA', 'CAIXA_DAGUA', 'ACTIVE', 'ONLINE', NOW(), NOW()),
    ('de303a00-0000-4000-8000-000000000005', v_tenant_id, v_customer_id, v_asset_id, 'METER',
     'Q303A Freezer', 'Freezer', 'Freezer', 'Q303A_FREEZER', 'SN-Q303A-005', 'FREEZER', 'FREEZER', 'ACTIVE', 'ONLINE', NOW(), NOW()),
    ('de303a00-0000-4000-8000-000000000006', v_tenant_id, v_customer_id, v_asset_id, 'METER',
     'Q303A Temperatura Salao', 'Temperatura Salão', 'Temperatura Salão', 'Q303A_AMBIENTE', 'SN-Q303A-006', 'TERMOMETRO', 'AMBIENTE', 'ACTIVE', 'ONLINE', NOW(), NOW())
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'single-dashboard-viewer: policy/role/user/assignment/devices ensured';
END $$;
