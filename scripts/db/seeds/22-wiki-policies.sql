-- =============================================================================
-- SEED: WIKI POLICIES (RFC-0030)
-- =============================================================================
-- Registers the RBAC policies used by the MYIO Wiki (knowledge base) module.
-- Permission format: domain.function.action (dot-separated, kebab-case).
--
--   wiki.page.{create,read,update,delete,publish,archive,move,review}
--   wiki.namespace.{create,read,update,delete}
--   wiki.attachment.{upload,read,delete}
--   wiki.visibility.{public,myio-internal,partners,
--                    holding-customers,non-holding-customers,tenant-private}
--
-- Companion RFC: docs/RFC-0030-MYIO-Wiki-Knowledge-Base.md
-- =============================================================================

DO $$
DECLARE
    v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
BEGIN

    -- =========================================================================
    -- Wiki — Author (create/edit/publish own tenant content)
    -- =========================================================================
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'ccccdd01-0030-0030-0030-000000000001',
        v_tenant_id,
        'policy:wiki-author',
        'Wiki Author',
        'Create, edit, publish, and move wiki pages within the author''s own tenant.',
        '[
            "wiki.page.read",
            "wiki.page.create",
            "wiki.page.update",
            "wiki.page.publish",
            "wiki.page.archive",
            "wiki.page.move",
            "wiki.namespace.read",
            "wiki.attachment.upload",
            "wiki.attachment.read",
            "wiki.visibility.tenant-private"
        ]',
        '[]',
        'low',
        false,
        1
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

    -- =========================================================================
    -- Wiki — Reviewer (approves drafts before publication)
    -- =========================================================================
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'ccccdd01-0030-0030-0030-000000000002',
        v_tenant_id,
        'policy:wiki-reviewer',
        'Wiki Reviewer',
        'Review and publish drafts submitted for review.',
        '[
            "wiki.page.read",
            "wiki.page.review",
            "wiki.page.publish",
            "wiki.namespace.read",
            "wiki.attachment.read"
        ]',
        '[]',
        'low',
        false,
        1
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

    -- =========================================================================
    -- Wiki — Viewer (read-only)
    -- =========================================================================
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'ccccdd01-0030-0030-0030-000000000003',
        v_tenant_id,
        'policy:wiki-viewer',
        'Wiki Viewer',
        'Read wiki pages (visibility-gated at the data layer).',
        '[
            "wiki.page.read",
            "wiki.namespace.read",
            "wiki.attachment.read"
        ]',
        '[]',
        'low',
        false,
        1
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

    -- =========================================================================
    -- Wiki — Partner Admin (can publish to PARTNERS audience)
    -- =========================================================================
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'ccccdd01-0030-0030-0030-000000000004',
        v_tenant_id,
        'policy:wiki-partner-admin',
        'Wiki Partner Admin',
        'All author permissions plus the ability to publish to the PARTNERS audience.',
        '[
            "wiki.page.read",
            "wiki.page.create",
            "wiki.page.update",
            "wiki.page.publish",
            "wiki.page.archive",
            "wiki.page.move",
            "wiki.namespace.read",
            "wiki.namespace.create",
            "wiki.attachment.upload",
            "wiki.attachment.read",
            "wiki.visibility.tenant-private",
            "wiki.visibility.partners"
        ]',
        '[]',
        'medium',
        false,
        1
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

    -- =========================================================================
    -- Wiki — MYIO Admin (full platform control, cross-tenant visibility)
    -- =========================================================================
    INSERT INTO policies (id, tenant_id, key, display_name, description, allow, deny, risk_level, is_system, version)
    VALUES (
        'ccccdd01-0030-0030-0030-000000000005',
        v_tenant_id,
        'policy:wiki-myio-admin',
        'Wiki MYIO Admin',
        'Full wiki control including PUBLIC, MYIO_INTERNAL, and cross-tenant customer visibility. '
        'Reserved for MYIO staff.',
        '[
            "wiki.*.*",
            "wiki.visibility.public",
            "wiki.visibility.myio-internal",
            "wiki.visibility.partners",
            "wiki.visibility.holding-customers",
            "wiki.visibility.non-holding-customers",
            "wiki.visibility.tenant-private"
        ]',
        '[]',
        'critical',
        false,
        1
    )
    ON CONFLICT (tenant_id, key) DO NOTHING;

END $$;
