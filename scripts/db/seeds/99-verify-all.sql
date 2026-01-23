-- =============================================================================
-- VERIFY ALL SEEDED DATA
-- =============================================================================
-- Quick verification of all seeded data with counts
-- =============================================================================

SELECT '==================== DATA VERIFICATION ====================' as info;

SELECT
    'customers' as table_name,
    COUNT(*) as total_records,
    COUNT(*) FILTER (WHERE status = 'ACTIVE') as active
FROM customers
UNION ALL
SELECT 'partners', COUNT(*), COUNT(*) FILTER (WHERE status = 'ACTIVE') FROM partners
UNION ALL
SELECT 'users', COUNT(*), COUNT(*) FILTER (WHERE status = 'ACTIVE') FROM users
UNION ALL
SELECT 'policies', COUNT(*), COUNT(*) FILTER (WHERE is_system = false) FROM policies
UNION ALL
SELECT 'roles', COUNT(*), COUNT(*) FILTER (WHERE is_system = false) FROM roles
UNION ALL
SELECT 'role_assignments', COUNT(*), COUNT(*) FILTER (WHERE status = 'active') FROM role_assignments
UNION ALL
SELECT 'assets', COUNT(*), COUNT(*) FILTER (WHERE status = 'ACTIVE') FROM assets
UNION ALL
SELECT 'devices', COUNT(*), COUNT(*) FILTER (WHERE status = 'ACTIVE') FROM devices
UNION ALL
SELECT 'rules', COUNT(*), COUNT(*) FILTER (WHERE enabled = true) FROM rules
UNION ALL
SELECT 'centrals', COUNT(*), COUNT(*) FILTER (WHERE status = 'ACTIVE') FROM centrals
UNION ALL
SELECT 'groups', COUNT(*), COUNT(*) FILTER (WHERE status = 'ACTIVE') FROM groups
UNION ALL
SELECT 'look_and_feels', COUNT(*), COUNT(*) FILTER (WHERE is_default = true) FROM look_and_feels
UNION ALL
SELECT 'customer_api_keys', COUNT(*), COUNT(*) FILTER (WHERE is_active = true) FROM customer_api_keys
UNION ALL
SELECT 'integration_packages', COUNT(*), COUNT(*) FILTER (WHERE status = 'PUBLISHED') FROM integration_packages
UNION ALL
SELECT 'package_subscriptions', COUNT(*), COUNT(*) FILTER (WHERE status = 'ACTIVE') FROM package_subscriptions
ORDER BY table_name;

-- Check rules CHECK constraints are working
SELECT '==================== RULES BY TYPE ====================' as info;
SELECT
    type,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE alarm_config IS NOT NULL) as has_alarm_config,
    COUNT(*) FILTER (WHERE sla_config IS NOT NULL) as has_sla_config,
    COUNT(*) FILTER (WHERE escalation_config IS NOT NULL) as has_escalation_config,
    COUNT(*) FILTER (WHERE maintenance_config IS NOT NULL) as has_maintenance_config
FROM rules
GROUP BY type
ORDER BY type;

-- Check hierarchical data
SELECT '==================== CUSTOMER HIERARCHY ====================' as info;
SELECT
    REPEAT('  ', depth) || name as hierarchy,
    code,
    type,
    depth
FROM customers
ORDER BY path;

SELECT '==================== ASSET HIERARCHY ====================' as info;
SELECT
    REPEAT('  ', depth) || name as hierarchy,
    code,
    type,
    depth
FROM assets
ORDER BY path;

SELECT '==================== VERIFICATION COMPLETE ====================' as info;
