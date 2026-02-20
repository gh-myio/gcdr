-- =============================================================================
-- SEED CLEANUP: KEEP ONLY DIMENSION ENTITIES
-- =============================================================================
-- Removes all seed/mock data NOT related to the Dimension customer.
-- Keeps:
--   - Dimension customer (77777777-7777-7777-7777-777777777777)
--   - ACME Holdings (22222222-...) as parent (FK dependency)
--   - Admin + Service Account users (system-level)
--   - Global entities: policies, roles, domain_permissions, integration_packages, partners
-- Deletes:
--   - ACME Tech, ACME Industrial, Branch SP, Branch RJ (customers)
--   - All assets, devices, centrals, rules NOT owned by Dimension
--   - All customer API keys NOT owned by Dimension
--   - All groups, look_and_feels, maintenance_groups for non-Dimension
--   - Non-system users and their role_assignments
--   - Non-Dimension package_subscriptions, alarm_bundle_versions
-- =============================================================================

DO $$
DECLARE
    v_dimension_id UUID := '77777777-7777-7777-7777-777777777777';
    v_holding_id  UUID := '22222222-2222-2222-2222-222222222222';
    v_admin_id    UUID := 'bbbb1111-1111-1111-1111-111111111111';
    v_service_id  UUID := 'bbbb5555-5555-5555-5555-555555555555';
    v_count INT;
BEGIN
    RAISE NOTICE '=== Starting cleanup: keep only Dimension entities ===';

    -- =========================================================================
    -- 1. ALARM BUNDLE VERSIONS (customer_id)
    -- =========================================================================
    DELETE FROM alarm_bundle_versions WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % alarm_bundle_versions', v_count;

    -- =========================================================================
    -- 2. AUDIT LOGS (clean all, they are transient)
    -- =========================================================================
    DELETE FROM audit_logs;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % audit_logs', v_count;

    -- =========================================================================
    -- 3. PACKAGE SUBSCRIPTIONS (subscriber_id = customer_id)
    -- =========================================================================
    DELETE FROM package_subscriptions WHERE subscriber_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % package_subscriptions', v_count;

    -- =========================================================================
    -- 4. CUSTOMER API KEYS (customer_id)
    -- =========================================================================
    DELETE FROM customer_api_keys WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % customer_api_keys', v_count;

    -- =========================================================================
    -- 5. LOOK AND FEELS (customer_id)
    -- =========================================================================
    DELETE FROM look_and_feels WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % look_and_feels', v_count;

    -- =========================================================================
    -- 6. GROUPS (customer_id)
    -- =========================================================================
    DELETE FROM groups WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % groups', v_count;

    -- =========================================================================
    -- 7. DEVICES (customer_id) — delete before centrals/assets (FK)
    -- =========================================================================
    DELETE FROM devices WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % devices', v_count;

    -- =========================================================================
    -- 8. CENTRALS (customer_id)
    -- =========================================================================
    DELETE FROM centrals WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % centrals', v_count;

    -- =========================================================================
    -- 9. ASSETS (customer_id)
    -- =========================================================================
    DELETE FROM assets WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % assets', v_count;

    -- =========================================================================
    -- 10. RULES (customer_id)
    -- =========================================================================
    DELETE FROM rules WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % rules', v_count;

    -- =========================================================================
    -- 11. USER BUNDLE CACHE (for users that will be deleted)
    -- =========================================================================
    DELETE FROM user_bundle_cache
    WHERE user_id NOT IN (v_admin_id, v_service_id)
      AND user_id IN (
          SELECT id FROM users
          WHERE (customer_id IS NOT NULL AND customer_id != v_dimension_id)
             OR partner_id IS NOT NULL
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % user_bundle_cache entries', v_count;

    -- =========================================================================
    -- 12. USER MAINTENANCE GROUPS (for users that will be deleted)
    -- =========================================================================
    DELETE FROM user_maintenance_groups
    WHERE user_id NOT IN (v_admin_id, v_service_id)
      AND user_id IN (
          SELECT id FROM users
          WHERE (customer_id IS NOT NULL AND customer_id != v_dimension_id)
             OR partner_id IS NOT NULL
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % user_maintenance_groups', v_count;

    -- =========================================================================
    -- 13. MAINTENANCE GROUPS (customer_id)
    -- =========================================================================
    DELETE FROM maintenance_groups WHERE customer_id != v_dimension_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % maintenance_groups', v_count;

    -- =========================================================================
    -- 14. ROLE ASSIGNMENTS (for users that will be deleted)
    -- =========================================================================
    DELETE FROM role_assignments
    WHERE user_id NOT IN (v_admin_id, v_service_id)
      AND user_id IN (
          SELECT id FROM users
          WHERE (customer_id IS NOT NULL AND customer_id != v_dimension_id)
             OR partner_id IS NOT NULL
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % role_assignments', v_count;

    -- =========================================================================
    -- 15. USERS (keep admin, service account; delete rest)
    -- =========================================================================
    DELETE FROM users
    WHERE id NOT IN (v_admin_id, v_service_id)
      AND (
          (customer_id IS NOT NULL AND customer_id != v_dimension_id)
          OR partner_id IS NOT NULL
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % users', v_count;

    -- =========================================================================
    -- 16. CUSTOMERS (keep Dimension + ACME Holdings parent)
    -- =========================================================================
    DELETE FROM customers
    WHERE id NOT IN (v_dimension_id, v_holding_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % customers', v_count;

    -- =========================================================================
    -- NOTE: The following global entities are intentionally KEPT:
    --   - partners (tenant-level, not customer-specific)
    --   - policies (global RBAC)
    --   - roles (global RBAC)
    --   - domain_permissions (global, tenant_id is NULL)
    --   - integration_packages (tenant-level marketplace)
    -- =========================================================================

    RAISE NOTICE '=== Cleanup complete ===';
END $$;

-- =============================================================================
-- VERIFY: Show remaining data counts
-- =============================================================================
SELECT 'customers' AS table_name, COUNT(*) AS count FROM customers
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'partners', COUNT(*) FROM partners
UNION ALL SELECT 'assets', COUNT(*) FROM assets
UNION ALL SELECT 'devices', COUNT(*) FROM devices
UNION ALL SELECT 'centrals', COUNT(*) FROM centrals
UNION ALL SELECT 'rules', COUNT(*) FROM rules
UNION ALL SELECT 'customer_api_keys', COUNT(*) FROM customer_api_keys
UNION ALL SELECT 'groups', COUNT(*) FROM groups
UNION ALL SELECT 'look_and_feels', COUNT(*) FROM look_and_feels
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'policies', COUNT(*) FROM policies
UNION ALL SELECT 'role_assignments', COUNT(*) FROM role_assignments
UNION ALL SELECT 'maintenance_groups', COUNT(*) FROM maintenance_groups
UNION ALL SELECT 'user_maintenance_groups', COUNT(*) FROM user_maintenance_groups
UNION ALL SELECT 'integration_packages', COUNT(*) FROM integration_packages
UNION ALL SELECT 'package_subscriptions', COUNT(*) FROM package_subscriptions
UNION ALL SELECT 'domain_permissions', COUNT(*) FROM domain_permissions
UNION ALL SELECT 'alarm_bundle_versions', COUNT(*) FROM alarm_bundle_versions
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
ORDER BY table_name;

-- =============================================================================
-- VERIFY: Show remaining Dimension entities
-- =============================================================================
SELECT 'Customers' AS entity, id, name FROM customers ORDER BY depth;
SELECT 'Assets' AS entity, id, name FROM assets ORDER BY depth;
SELECT 'Devices' AS entity, id, name FROM devices ORDER BY name;
SELECT 'Centrals' AS entity, id, name FROM centrals;
SELECT 'Rules' AS entity, id, name FROM rules ORDER BY name LIMIT 10;
SELECT 'API Keys' AS entity, id, name FROM customer_api_keys;
SELECT 'Users' AS entity, id, email FROM users;
