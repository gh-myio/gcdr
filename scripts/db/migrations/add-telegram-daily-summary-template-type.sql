-- Migration: add TELEGRAM_DAILY_SUMMARY template type
-- Run after: add-telegram-alarm-template-types.sql

-- 1) Expand CHECK constraint to accept the new type
ALTER TABLE templates
  DROP CONSTRAINT IF EXISTS templates_type_check;

ALTER TABLE templates
  ADD CONSTRAINT templates_type_check
    CHECK (type IN (
      'EMAIL_ALARM',
      'EMAIL_REPORT',
      'EMAIL_WELCOME',
      'RELEASE_NOTE',
      'NOTIFICATION',
      'INSIGHT',
      'TELEGRAM_ALARM_OPENED',
      'TELEGRAM_ALARM_CLOSED',
      'TELEGRAM_ALARM_ESCALATED',
      'TELEGRAM_ALARM_ACKNOWLEDGED',
      'TELEGRAM_ALARM_SNOOZED',
      'TELEGRAM_ALARM_DIGEST',
      'TELEGRAM_DAILY_SUMMARY'
    ));

-- 2) Register in template_types catalog
INSERT INTO template_types (type, label, description, icon, sort_order, active)
VALUES (
  'TELEGRAM_DAILY_SUMMARY',
  'Telegram — Resumo Diário',
  'Resumo diário enviado uma vez ao dia com totais de alarmes e status de dispositivos',
  'telegram',
  16,
  true
)
ON CONFLICT (type) DO NOTHING;

-- Verify
SELECT type, label, active FROM template_types WHERE type = 'TELEGRAM_DAILY_SUMMARY';
