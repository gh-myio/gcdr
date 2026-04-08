-- =============================================================================
-- OPS: Myio — Telegram Daily Summary Template
-- =============================================================================
-- Tenant  : 11111111-1111-1111-1111-111111111111
-- Customer: NULL (tenant default)
-- Type    : TELEGRAM_DAILY_SUMMARY
-- =============================================================================

INSERT INTO templates (id, tenant_id, customer_id, slug, name, type, status, description, html_content, version)
VALUES (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'telegram-daily-summary',
  'Telegram — Resumo Diário',
  'TELEGRAM_DAILY_SUMMARY',
  'ACTIVE',
  'Resumo diário enviado uma vez ao dia via Telegram com totais de alarmes e status de dispositivos.',
  U&'📅 <b>RESUMO DO DIA \2014 {{report.date}}</b>\000A📍 <b>{{customer.name}}</b>\000A\000A\2501\2501\2501\2501\2501\2501\2501\2501\2501\2501\000A🚨 <b>Alarmes</b>\000A  \2022 Abertos hoje: <b>{{summary.alarmsOpened}}</b>\000A  \2022 Resolvidos: <b>{{summary.alarmsClosed}}</b>\000A  \2022 Ainda ativos: <b>{{summary.alarmsActive}}</b>\000A\000A📡 <b>Dispositivos</b>\000A  \2022 Online: <b>{{summary.devicesOnline}}</b>\000A  \2022 Offline: <b>{{summary.devicesOffline}}</b>\000A{{#if summary.alarmsActive}}\000A\000A⚠️ <b>Alarmes em aberto:</b>\000A{{#each activeAlarms}}\000A  \00B7 {{alarm.title}} <i>(desde {{alarm.raisedAt}})</i>\000A{{/each}}{{/if}}\000A\2501\2501\2501\2501\2501\2501\2501\2501\2501\2501\000A<i>Gerado automaticamente às {{report.generatedAt}}</i>',
  1
)
ON CONFLICT DO NOTHING;

-- Verify
SELECT id, slug, type, status, version,
       left(html_content, 80) AS html_preview
FROM templates
WHERE slug = 'telegram-daily-summary'
  AND tenant_id = '11111111-1111-1111-1111-111111111111';
