-- Migration: add RELEASE_NOTE to templates type CHECK constraint
-- Run after: html-templates.sql

ALTER TABLE templates
  DROP CONSTRAINT IF EXISTS templates_type_check;

ALTER TABLE templates
  ADD CONSTRAINT templates_type_check
    CHECK (type IN ('EMAIL_ALARM', 'EMAIL_REPORT', 'EMAIL_WELCOME', 'RELEASE_NOTE'));
