-- =============================================================================
-- Migration: add notifications JSONB to rules
-- =============================================================================
-- Adds per-category notification recipients to rules, separate from the
-- existing notification_channels (delivery mechanism config).
--
-- Structure:
--   notifications: {
--     alarmNotify?:  { enabled: bool, recipients: [...] }
--     alarmReport?:  { enabled: bool, recipients: [...] }
--     alarmInsight?: { enabled: bool, recipients: [...] }
--   }
--
-- Each recipient:
--   { name, email, sourceType: 'USER'|'GROUP_MEMBER'|'MANUAL', userId?, groupId? }
-- =============================================================================

ALTER TABLE rules
  ADD COLUMN IF NOT EXISTS notifications JSONB;

COMMENT ON COLUMN rules.notifications IS
  'Per-category notification recipients: alarmNotify, alarmReport, alarmInsight. '
  'Each has enabled flag and recipients array with sourceType USER|GROUP_MEMBER|MANUAL.';
