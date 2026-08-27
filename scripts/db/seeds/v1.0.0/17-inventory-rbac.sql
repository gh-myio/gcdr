-- =============================================================================
-- SEED: INVENTORY RBAC (RFC-0061 M10)
-- =============================================================================
-- Policies + roles for the Inventory domain ("Estoque"), mapping the source
-- system's roles (solicitante/comprador/fabrica/admin) onto governed GCDR
-- RBAC (§RBAC of RFC-0061).
--
-- Permission format: domain.function.action (as in 04-policies.sql).
-- RFC-0057 split-verb lesson applied: destructive/admin verbs (delete, reset,
-- sync run, manage) are NOT reachable from read-only policies — policy:read-only
-- ("*.*.read"/"*.*.list") can never reach them.
--
-- Standalone file on purpose: does NOT edit existing seeds (04/05/06).
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
    -- =========================================================================
    -- POLICIES
    -- =========================================================================

    -- Requester (source: solicitante) — open purchase requests against the
    -- catalog, follow OWN orders, confirm receipt; read catalog/stock/projects.
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cc610061-0001-4000-8000-000000000001',
        v_tenant_id,
        'policy:inventory-requester',
        'Inventory Requester',
        'Create purchase orders, follow and edit own pending orders, confirm receipt; read catalog, stock balances and projects (RFC-0061 §RBAC)',
        '[
            "inventory.purchase-order.create",
            "inventory.purchase-order.read-own",
            "inventory.purchase-order.update-own-pending",
            "inventory.purchase-order.confirm-receipt",
            "inventory.item.read",
            "inventory.item.list",
            "inventory.stock.read",
            "inventory.stock.list",
            "inventory.project.read",
            "inventory.project.list"
        ]',
        '[]',
        'low',
        false,
        1
    );

    -- Buyer (source: comprador) — the buyer queue: every order, buyer statuses,
    -- notes, passphrase, delivery forecast, attachments. Grant TOGETHER with
    -- policy:inventory-requester (see role below).
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cc610061-0002-4000-8000-000000000002',
        v_tenant_id,
        'policy:inventory-buyer',
        'Inventory Buyer',
        'Buyer queue: read/manage all purchase orders (buyer statuses, notes, passphrase, forecast, files) — RFC-0061 §M3',
        '[
            "inventory.purchase-order.read",
            "inventory.purchase-order.list",
            "inventory.purchase-order.manage",
            "inventory.purchase-order-file.create",
            "inventory.purchase-order-file.delete",
            "inventory.purchase-order-event.read"
        ]',
        '[]',
        'medium',
        false,
        1
    );

    -- Factory (source: fabrica) — fábrica-scoped stock/BOM/assembly/production
    -- read-write; homologation & QR; expedition READ-ONLY; no deletes, no
    -- stock reset, no sync run (explicit denies).
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cc610061-0003-4000-8000-000000000003',
        v_tenant_id,
        'policy:inventory-factory',
        'Inventory Factory',
        'Factory operations: stock movements, BOM, assembly releases, production queue, homologation and QR; expedition read-only; no destructive verbs (RFC-0061 §RBAC)',
        '[
            "inventory.item.read",
            "inventory.item.list",
            "inventory.bom.read",
            "inventory.bom.update",
            "inventory.stock.read",
            "inventory.stock.list",
            "inventory.stock-movement.create",
            "inventory.stock-movement.read",
            "inventory.stock-movement.list",
            "inventory.stock-transfer.create",
            "inventory.assembly-release.create",
            "inventory.assembly-release.read",
            "inventory.assembly-release.list",
            "inventory.assembly-release.correct",
            "inventory.assembly-issue.create",
            "inventory.assembly-issue.read",
            "inventory.assembly-issue.resolve",
            "inventory.production.read",
            "inventory.production.list",
            "inventory.homologation.create",
            "inventory.homologation.read",
            "inventory.homologation.list",
            "inventory.homologation.manage-box",
            "inventory.qr.read",
            "inventory.qr.validate",
            "inventory.qr.trace",
            "inventory.expedition-order.read",
            "inventory.expedition-order.list"
        ]',
        '[
            "inventory.item.delete",
            "inventory.assembly-release.delete",
            "inventory.expedition-order.create",
            "inventory.expedition-order.update",
            "inventory.expedition-order.delete",
            "inventory.purchase-order.manage",
            "inventory.stock.reset",
            "inventory.external.sync-run",
            "inventory.project.delete"
        ]',
        'medium',
        false,
        1
    );

    -- Admin (source: admin) — full inventory domain including deletes, stock
    -- reset, projects, sync run. Wildcard on the inventory domain ONLY;
    -- destructive endpoints additionally demand the server-side
    -- confirmationToken (API convention S3), which RBAC does not replace.
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cc610061-0004-4000-8000-000000000004',
        v_tenant_id,
        'policy:inventory-admin',
        'Inventory Administrator',
        'Full inventory domain including deletes, stock reset, projects and external sync run (RFC-0061 §RBAC). Destructive verbs still require the confirmation token.',
        '["inventory.*.*"]',
        '[]',
        'high',
        false,
        1
    );

    -- M2M sync (customer API keys gcdr_cust_*) — Node-RED/cron integrations:
    -- trigger the external sync and read mirrored states. Customer API keys
    -- carry scopes directly; this policy exists so JWT service users can get
    -- the same reach through a role when needed.
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'cc610061-0005-4000-8000-000000000005',
        v_tenant_id,
        'policy:inventory-external-sync',
        'Inventory External Sync (M2M)',
        'Trigger the external product-tracking sync and read mirrored states — for M2M integrations (RFC-0061 §M8, DEC-7)',
        '[
            "inventory.external.sync-run",
            "inventory.external.read",
            "inventory.external.list"
        ]',
        '[]',
        'medium',
        false,
        1
    );

    RAISE NOTICE 'Inserted 5 inventory policies';

    -- =========================================================================
    -- ROLES (grants = policies array, as in 05-roles.sql)
    -- =========================================================================

    -- solicitante → role:inventory-requester
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dd610061-0001-4000-8000-000000000001',
        v_tenant_id,
        'role:inventory-requester',
        'Inventory Requester',
        'Opens purchase requests and follows own orders (source role: solicitante)',
        '["policy:inventory-requester"]',
        '["inventory", "requester"]',
        'low',
        false,
        1
    );

    -- comprador → role:inventory-buyer (requester + buyer queue)
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dd610061-0002-4000-8000-000000000002',
        v_tenant_id,
        'role:inventory-buyer',
        'Inventory Buyer',
        'Buyer queue: manages every purchase order plus requester abilities (source role: comprador)',
        '["policy:inventory-requester", "policy:inventory-buyer"]',
        '["inventory", "buyer"]',
        'medium',
        false,
        1
    );

    -- fabrica → role:inventory-factory
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dd610061-0003-4000-8000-000000000003',
        v_tenant_id,
        'role:inventory-factory',
        'Inventory Factory',
        'Factory floor: stock, BOM, assembly, production, homologation and QR; expedition read-only, no destructive verbs (source role: fabrica)',
        '["policy:inventory-factory"]',
        '["inventory", "factory"]',
        'medium',
        false,
        1
    );

    -- admin → role:inventory-admin
    INSERT INTO roles (id, tenant_id, key, display_name, description, policies, tags, risk_level, is_system, version)
    VALUES (
        'dd610061-0004-4000-8000-000000000004',
        v_tenant_id,
        'role:inventory-admin',
        'Inventory Administrator',
        'Full inventory domain including deletes, stock reset, projects and sync run (source role: admin)',
        '["policy:inventory-admin"]',
        '["inventory", "admin"]',
        'high',
        false,
        1
    );

    RAISE NOTICE 'Inserted 4 inventory roles';
END $$;

-- Verify
SELECT key, display_name, risk_level FROM policies WHERE key LIKE 'policy:inventory-%' ORDER BY key;
SELECT key, display_name, risk_level FROM roles WHERE key LIKE 'role:inventory-%' ORDER BY key;
