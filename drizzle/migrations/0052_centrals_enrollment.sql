-- Migration 0052: zero-touch central enrollment (Slice 1.5).
--
-- A central self-registers and receives its `agent_secret` with zero field-tech
-- action via a one-time enroll token:
--   - enroll_token_hash       sha256(enrollToken) — only the HASH is stored,
--                             never the plaintext token. Cleared on a successful
--                             enroll so the token is single-use.
--   - enroll_token_expires_at when the pending token stops being accepted
--                             (default 24h after issue).
--   - enrolled_at             when the central last completed enrollment.
--
-- All nullable: a central with no pending token simply cannot enroll until an
-- operator issues one. Re-issuing a fresh token re-enables enrollment (needed
-- for field-swap: new hardware adopts the old central's id).
--
-- No BEGIN/COMMIT: the migration runner wraps each file in its own transaction.

ALTER TABLE "centrals" ADD COLUMN "enroll_token_hash" text;
ALTER TABLE "centrals" ADD COLUMN "enroll_token_expires_at" timestamptz;
ALTER TABLE "centrals" ADD COLUMN "enrolled_at" timestamptz;
