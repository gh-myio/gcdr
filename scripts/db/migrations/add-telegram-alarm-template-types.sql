-- Migration: add TELEGRAM_ALARM_* template types
-- Run after: add-notification-insight-template-types.sql

-- 1) Ampliar o CHECK constraint para aceitar os 6 novos tipos
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
      'TELEGRAM_ALARM_DIGEST'
    ));

-- 2) Registrar os tipos no catálogo
INSERT INTO template_types (type, label, description, icon, sort_order, active)
VALUES
  ('TELEGRAM_ALARM_OPENED',      'Telegram — Alarme Aberto',       'Mensagem enviada ao grupo quando um alarme é aberto',                    'telegram', 10, true),
  ('TELEGRAM_ALARM_CLOSED',      'Telegram — Alarme Fechado',       'Mensagem enviada quando o alarme é resolvido/fechado',                   'telegram', 11, true),
  ('TELEGRAM_ALARM_ESCALATED',   'Telegram — Alarme Escalado',      'Mensagem enviada quando o alarme é escalado por falta de ACK',          'telegram', 12, true),
  ('TELEGRAM_ALARM_ACKNOWLEDGED','Telegram — Alarme Reconhecido',   'Mensagem enviada quando o alarme é reconhecido (ACK)',                  'telegram', 13, true),
  ('TELEGRAM_ALARM_SNOOZED',     'Telegram — Alarme Silenciado',    'Mensagem enviada quando o alarme é silenciado temporariamente',         'telegram', 14, true),
  ('TELEGRAM_ALARM_DIGEST',      'Telegram — Digest de Alarmes',    'Mensagem agrupada com múltiplos alarmes do mesmo tipo na janela',       'telegram', 15, true)
ON CONFLICT (type) DO NOTHING;
