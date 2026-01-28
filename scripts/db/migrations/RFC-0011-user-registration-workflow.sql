-- =============================================================================
-- RFC-0011: User Registration and Approval Workflow
-- =============================================================================
-- Migration to add user registration, email verification, and account lockout
-- =============================================================================

-- Step 1: Create verification token type enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_token_type') THEN
        CREATE TYPE verification_token_type AS ENUM (
            'EMAIL_VERIFICATION',
            'PASSWORD_RESET',
            'ACCOUNT_UNLOCK'
        );
        RAISE NOTICE 'Created verification_token_type enum';
    ELSE
        RAISE NOTICE 'verification_token_type enum already exists';
    END IF;
END $$;

-- Step 2: Update user_status enum
-- Note: PostgreSQL doesn't allow easy enum value renaming/reordering,
-- so we add new values and handle legacy values in the application

DO $$
BEGIN
    -- Add UNVERIFIED if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'UNVERIFIED'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_status')
    ) THEN
        ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'UNVERIFIED' BEFORE 'ACTIVE';
        RAISE NOTICE 'Added UNVERIFIED to user_status enum';
    END IF;

    -- Add PENDING_APPROVAL if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'PENDING_APPROVAL'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_status')
    ) THEN
        ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL' AFTER 'UNVERIFIED';
        RAISE NOTICE 'Added PENDING_APPROVAL to user_status enum';
    END IF;
EXCEPTION WHEN others THEN
    -- Enum values may already exist, which is fine
    RAISE NOTICE 'Note: Some enum values may already exist';
END $$;

-- Step 3: Create verification_tokens table
CREATE TABLE IF NOT EXISTS verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Token data
    token_type verification_token_type NOT NULL,
    code_hash VARCHAR(64) NOT NULL,  -- SHA256 hash of 6-digit code

    -- Expiration
    expires_at TIMESTAMPTZ NOT NULL,

    -- Usage tracking
    used_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,

    -- Metadata
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_attempts CHECK (attempts <= max_attempts)
);

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS idx_verification_tokens_user
    ON verification_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_type
    ON verification_tokens(token_type);

CREATE INDEX IF NOT EXISTS idx_verification_tokens_expires
    ON verification_tokens(expires_at)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_verification_tokens_tenant_user_type
    ON verification_tokens(tenant_id, user_id, token_type);

-- Step 5: Migration of existing users with PENDING_VERIFICATION to UNVERIFIED
-- (Only if PENDING_VERIFICATION exists and there are users with that status)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'PENDING_VERIFICATION'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_status')
    ) THEN
        UPDATE users
        SET status = 'UNVERIFIED'
        WHERE status = 'PENDING_VERIFICATION';

        RAISE NOTICE 'Migrated PENDING_VERIFICATION users to UNVERIFIED';
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Note: No users needed migration from PENDING_VERIFICATION';
END $$;

-- Step 6: Migration of existing users with SUSPENDED to LOCKED
-- (Only if SUSPENDED exists and there are users with that status)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'SUSPENDED'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_status')
    ) THEN
        UPDATE users
        SET status = 'LOCKED'
        WHERE status = 'SUSPENDED';

        RAISE NOTICE 'Migrated SUSPENDED users to LOCKED';
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Note: No users needed migration from SUSPENDED';
END $$;

-- Verify migration
SELECT
    'verification_tokens' as table_name,
    COUNT(*) as count
FROM verification_tokens
UNION ALL
SELECT
    'users by status' as table_name,
    COUNT(*) as count
FROM users
GROUP BY status;

-- Show enum values
SELECT enumlabel, enumsortorder
FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_status')
ORDER BY enumsortorder;

RAISE NOTICE '=============================================================================';
RAISE NOTICE 'RFC-0011 Migration Complete';
RAISE NOTICE '=============================================================================';
