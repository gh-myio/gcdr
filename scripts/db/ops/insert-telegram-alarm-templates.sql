-- =============================================================================
-- Inserir templates padrão de Telegram para alarmes
-- Tenant: 11111111-1111-1111-1111-111111111111 (tenant default — customerId NULL)
--
-- Rodar APÓS a migration add-telegram-alarm-template-types.sql
-- =============================================================================

INSERT INTO templates (id, tenant_id, customer_id, slug, name, type, status, description, html_content, version)
VALUES

-- ── alarm.opened ─────────────────────────────────────────────────────────────
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'telegram-alarm-opened',
  'Telegram — Alarme Aberto',
  'TELEGRAM_ALARM_OPENED',
  'ACTIVE',
  'Mensagem Telegram enviada quando um alarme é aberto. Suporta HTML do Telegram (bold, italic).',
  U&'🚨 <b>ALARME ABERTO</b>\0020\2014 {{alarm.severity}}\000A\000A<b>{{alarm.title}}</b>\000A{{#if alarm.description}}{{alarm.description}}\000A{{/if}}\000A\000A📍 <b>Cliente:</b> {{customer.name}}\000A🔧 <b>Dispositivo:</b> {{device.name}}{{#if device.value}}\000A📊 <b>Valor:</b> {{device.value}}{{#if device.unit}} {{device.unit}}{{/if}}{{/if}}\000A⏰ <b>Aberto em:</b> {{alarm.raisedAt}}\000A\000A<i>ID: {{alarm.id}}</i>',
  1
),

-- ── alarm.closed ─────────────────────────────────────────────────────────────
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'telegram-alarm-closed',
  'Telegram — Alarme Fechado',
  'TELEGRAM_ALARM_CLOSED',
  'ACTIVE',
  'Mensagem Telegram enviada quando um alarme é resolvido/fechado.',
  U&'✅ <b>ALARME RESOLVIDO</b>\000A\000A<b>{{alarm.title}}</b>\000A{{#if alarm.resolution}}\000A<b>Resolução:</b> {{alarm.resolution}}\000A{{/if}}\000A\000A📍 <b>Cliente:</b> {{customer.name}}\000A🔧 <b>Dispositivo:</b> {{device.name}}\000A⏰ <b>Aberto em:</b> {{alarm.raisedAt}}\000A⏰ <b>Fechado em:</b> {{alarm.closedAt}}\000A\000A<i>ID: {{alarm.id}}</i>',
  1
),

-- ── alarm.escalated ──────────────────────────────────────────────────────────
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'telegram-alarm-escalated',
  'Telegram — Alarme Escalado',
  'TELEGRAM_ALARM_ESCALATED',
  'ACTIVE',
  'Mensagem Telegram enviada quando o alarme é escalado por falta de ACK.',
  U&'⚠️ <b>ESCALAÇÃO \2014 Nível {{alarm.escalationLevel}}</b>\000A\000AEste alarme foi escalado por falta de resposta.\000A\000A<b>{{alarm.title}}</b>\000A\000A📍 <b>Cliente:</b> {{customer.name}}\000A🔧 <b>Dispositivo:</b> {{device.name}}\000A⏰ <b>Aberto em:</b> {{alarm.raisedAt}}\000A⏰ <b>Escalado em:</b> {{alarm.escalatedAt}}\000A📣 <b>Notificações anteriores:</b> {{alarm.dispatchCount}}\000A\000A<i>ID: {{alarm.id}}</i>',
  1
),

-- ── alarm.acknowledged ───────────────────────────────────────────────────────
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'telegram-alarm-acknowledged',
  'Telegram — Alarme Reconhecido',
  'TELEGRAM_ALARM_ACKNOWLEDGED',
  'ACTIVE',
  'Mensagem Telegram enviada quando o alarme é reconhecido (ACK).',
  U&'👁️ <b>ALARME RECONHECIDO</b>\000A\000A<b>{{alarm.title}}</b>\000A\000AReconhecido por: <b>{{acknowledgedBy}}</b>\000A\000A📍 <b>Cliente:</b> {{customer.name}}\000A🔧 <b>Dispositivo:</b> {{device.name}}\000A⏰ <b>Aberto em:</b> {{alarm.raisedAt}}\000A⏰ <b>Reconhecido em:</b> {{alarm.acknowledgedAt}}{{#if alarm.notes}}\000A\000A<b>Observações:</b> {{alarm.notes}}{{/if}}\000A\000A<i>ID: {{alarm.id}}</i>',
  1
),

-- ── alarm.snoozed ────────────────────────────────────────────────────────────
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'telegram-alarm-snoozed',
  'Telegram — Alarme Silenciado',
  'TELEGRAM_ALARM_SNOOZED',
  'ACTIVE',
  'Mensagem Telegram enviada quando o alarme é silenciado temporariamente.',
  U&'💤 <b>ALARME SILENCIADO</b>\000A\000A<b>{{alarm.title}}</b>\000A\000A📍 <b>Cliente:</b> {{customer.name}}\000A🔧 <b>Dispositivo:</b> {{device.name}}\000A⏰ <b>Aberto em:</b> {{alarm.raisedAt}}\000A⏰ <b>Silenciado em:</b> {{alarm.snoozedAt}}\000A⏰ <b>Retomar em:</b> {{alarm.silencedUntil}}{{#if alarm.reason}}\000A\000A<b>Motivo:</b> {{alarm.reason}}{{/if}}\000A\000A<i>ID: {{alarm.id}}</i>',
  1
),

-- ── alarm.digest ─────────────────────────────────────────────────────────────
(
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'telegram-alarm-digest',
  'Telegram — Digest de Alarmes',
  'TELEGRAM_ALARM_DIGEST',
  'ACTIVE',
  'Mensagem Telegram agrupada com múltiplos alarmes do mesmo tipo.',
  U&'📊 <b>DIGEST DE ALARMES</b>\000A\000A<b>{{alarm.count}} alarmes</b> do tipo <b>{{alarm.type}}</b> foram agrupados.\000A\000A📍 <b>Cliente:</b> {{customer.name}}\000A⏰ <b>Janela:</b> {{digest.windowStart}} \2013 {{digest.windowEnd}}\000A📈 <b>Limite:</b> {{digest.threshold}} alarmes\000A\000A{{#if alarm.severity}}<b>Maior severidade:</b> {{alarm.severity}}\000A{{/if}}\000A<i>Revise os alarmes no painel de gestão.</i>',
  1
)

ON CONFLICT DO NOTHING;

-- Verificação
SELECT slug, type, status, version FROM templates
WHERE type LIKE 'TELEGRAM_ALARM%'
ORDER BY type;
