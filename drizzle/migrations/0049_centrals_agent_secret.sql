-- Migration 0049: centrals.agent_secret — shared HMAC secret the central signs
-- its poll-loop JWT (HS256) with, so /api/v1/central-agent can authenticate the
-- device (centralAuthMiddleware verifies the token against this column).
--
-- Nullable: provisioning the secret is a later slice; existing centrals keep
-- working (a central with no agent_secret is simply rejected at the gate).
--
-- No BEGIN/COMMIT: the migration runner wraps each file in its own transaction.

ALTER TABLE "centrals" ADD COLUMN "agent_secret" text;
