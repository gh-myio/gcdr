-- =============================================================================
-- CLEAR ALL DATA
-- =============================================================================
-- This script removes all data from all tables in the correct order
-- to respect foreign key constraints
-- =============================================================================

BEGIN;

-- Disable triggers temporarily for faster deletion
SET session_replication_role = 'replica';

-- Delete in reverse dependency order
TRUNCATE TABLE audit_logs CASCADE;
TRUNCATE TABLE package_subscriptions CASCADE;
TRUNCATE TABLE integration_packages CASCADE;
TRUNCATE TABLE customer_api_keys CASCADE;
TRUNCATE TABLE look_and_feels CASCADE;
TRUNCATE TABLE groups CASCADE;
TRUNCATE TABLE centrals CASCADE;
TRUNCATE TABLE devices CASCADE;
TRUNCATE TABLE assets CASCADE;
TRUNCATE TABLE rules CASCADE;
TRUNCATE TABLE role_assignments CASCADE;
TRUNCATE TABLE roles CASCADE;
TRUNCATE TABLE policies CASCADE;
TRUNCATE TABLE users CASCADE;
TRUNCATE TABLE partners CASCADE;
TRUNCATE TABLE customers CASCADE;

-- Re-enable triggers
SET session_replication_role = 'origin';

COMMIT;

-- Verify all tables are empty
SELECT 'customers' as table_name, COUNT(*) as count FROM customers
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'partners', COUNT(*) FROM partners
UNION ALL SELECT 'assets', COUNT(*) FROM assets
UNION ALL SELECT 'devices', COUNT(*) FROM devices
UNION ALL SELECT 'rules', COUNT(*) FROM rules
UNION ALL SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'policies', COUNT(*) FROM policies
UNION ALL SELECT 'role_assignments', COUNT(*) FROM role_assignments
UNION ALL SELECT 'groups', COUNT(*) FROM groups
UNION ALL SELECT 'centrals', COUNT(*) FROM centrals
UNION ALL SELECT 'look_and_feels', COUNT(*) FROM look_and_feels
UNION ALL SELECT 'customer_api_keys', COUNT(*) FROM customer_api_keys
UNION ALL SELECT 'integration_packages', COUNT(*) FROM integration_packages
UNION ALL SELECT 'package_subscriptions', COUNT(*) FROM package_subscriptions
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
ORDER BY table_name;
