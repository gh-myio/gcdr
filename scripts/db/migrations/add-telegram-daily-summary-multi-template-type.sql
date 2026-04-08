-- Migration: add TELEGRAM_DAILY_SUMMARY_MULTI template type
-- Run after: add-telegram-daily-summary-template-type.sql

-- 1) Expand CHECK constraint
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
      'TELEGRAM_DAILY_SUMMARY',
      'TELEGRAM_DAILY_SUMMARY_MULTI'
    ));

-- 2) Register in template_types catalog
INSERT INTO template_types (type, label, description, icon, sort_order, active)
VALUES (
  'TELEGRAM_DAILY_SUMMARY_MULTI',
  'Telegram — Resumo Diário Multi-Cliente',
  'Resumo diário consolidado de todos os customers, enviado ao grupo interno MYIO',
  'telegram',
  17,
  true
)
ON CONFLICT (type) DO NOTHING;

-- Verify
SELECT type, label, active FROM template_types
WHERE type IN ('TELEGRAM_DAILY_SUMMARY', 'TELEGRAM_DAILY_SUMMARY_MULTI')
ORDER BY sort_order;
