-- Migration: remove external_id from users
-- Reason: column was never used (no service/repository/DTO references it)
-- Replaced by: external_links JSONB (RFC-0028 follow-up)

ALTER TABLE users DROP COLUMN IF EXISTS external_id;
