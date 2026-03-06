-- Migration: add NOTIFICATION and INSIGHT to templates type CHECK constraint
-- Run after: add-release-note-template-type.sql

ALTER TABLE templates
  DROP CONSTRAINT IF EXISTS templates_type_check;

ALTER TABLE templates
  ADD CONSTRAINT templates_type_check
    CHECK (type IN ('EMAIL_ALARM', 'EMAIL_REPORT', 'EMAIL_WELCOME', 'RELEASE_NOTE', 'NOTIFICATION', 'INSIGHT'));
