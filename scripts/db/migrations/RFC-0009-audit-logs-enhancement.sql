-- ============================================================================
-- RFC-0009: Events Audit Logs Enhancement
-- Migration to add new columns and enums to audit_logs table
-- ============================================================================

-- Create new enums (if they don't exist)
DO $$ BEGIN
    CREATE TYPE event_category AS ENUM (
        'ENTITY_CHANGE', 'USER_ACTION', 'SYSTEM_EVENT', 'QUERY', 'AUTH', 'INTEGRATION'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE actor_type AS ENUM (
        'USER', 'SYSTEM', 'API_KEY', 'SERVICE_ACCOUNT', 'ANONYMOUS'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE audit_level AS ENUM (
        'MINIMAL', 'STANDARD', 'VERBOSE', 'DEBUG'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add new columns to audit_logs table
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS event_category event_category,
    ADD COLUMN IF NOT EXISTS audit_level audit_level DEFAULT 'STANDARD',
    ADD COLUMN IF NOT EXISTS description VARCHAR(500),
    ADD COLUMN IF NOT EXISTS actor_type actor_type DEFAULT 'USER',
    ADD COLUMN IF NOT EXISTS customer_id UUID,
    ADD COLUMN IF NOT EXISTS http_method VARCHAR(10),
    ADD COLUMN IF NOT EXISTS http_path VARCHAR(500),
    ADD COLUMN IF NOT EXISTS status_code INTEGER,
    ADD COLUMN IF NOT EXISTS error_message VARCHAR(2000),
    ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS external_link VARCHAR(255);

-- Make entity_id nullable (for events without specific entity)
ALTER TABLE audit_logs ALTER COLUMN entity_id DROP NOT NULL;

-- Change user_agent from TEXT to VARCHAR(500)
ALTER TABLE audit_logs ALTER COLUMN user_agent TYPE VARCHAR(500);

-- Create new indexes
CREATE INDEX IF NOT EXISTS audit_logs_tenant_customer_idx ON audit_logs(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_category_idx ON audit_logs(tenant_id, event_category);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_action_idx ON audit_logs(tenant_id, action);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_level_idx ON audit_logs(tenant_id, audit_level);

-- Backfill event_category for existing records
UPDATE audit_logs SET event_category = 'ENTITY_CHANGE' WHERE event_category IS NULL;

-- Make event_category NOT NULL after backfill
ALTER TABLE audit_logs ALTER COLUMN event_category SET NOT NULL;

-- Verify migration
DO $$
DECLARE
    col_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO col_count
    FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND table_schema = 'public';

    IF col_count >= 26 THEN
        RAISE NOTICE 'RFC-0009 migration completed successfully. audit_logs has % columns.', col_count;
    ELSE
        RAISE WARNING 'RFC-0009 migration may be incomplete. Expected 26+ columns, found %.', col_count;
    END IF;
END $$;
