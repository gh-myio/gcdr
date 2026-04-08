-- =============================================================================
-- OPS: Myio — Telegram Daily Summary Multi-Customer Template
-- =============================================================================
-- Tenant  : 11111111-1111-1111-1111-111111111111
-- Customer: NULL (tenant default)
-- Type    : TELEGRAM_DAILY_SUMMARY_MULTI
-- Target  : Grupo Interno MYIO Alarmes (945acbfb-9b96-4073-9555-c0f61a4860be)
--
-- statusIcon is computed by the alarm backend:
--   🔴 alarmsActive > 0
--   🟡 alarmsActive = 0 and devicesOffline > 0
--   🟢 all clear
-- =============================================================================

INSERT INTO templates (id, tenant_id, customer_id, slug, name, type, status, description, html_content, version)
VALUES (
  gen_random_uuid(),
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'telegram-daily-summary-multi',
  'Telegram — Resumo Diário Multi-Cliente',
  'TELEGRAM_DAILY_SUMMARY_MULTI',
  'ACTIVE',
  'Resumo diário consolidado de todos os customers enviado ao grupo interno MYIO. O statusIcon (🔴/🟡/🟢) é calculado pelo alarm backend.',
  U&'📅 <b>RESUMO DO DIA \2014 {{report.date}}</b>\000A🏢 {{summary.totalCustomers}} clientes monitorados\000A\000A\2501\2501\2501\2501\2501\2501\2501\2501\2501\2501\000A🚨 <b>{{summary.totalAlarmsActive}} alarmes ativos</b>  |  📡 <b>{{summary.totalDevicesOffline}} dispositivos offline</b>\000A\000A{{#each customers}}\000A{{customer.statusIcon}} <b>{{customer.name}}</b>\000A   Alarmes: {{customer.alarmsActive}} ativos / {{customer.alarmsOpened}} abertos hoje  |  Offline: {{customer.devicesOffline}}\000A\000A{{/each}}\000A\2501\2501\2501\2501\2501\2501\2501\2501\2501\2501\000A<i>Gerado automaticamente às {{report.generatedAt}}</i>',
  1
)
ON CONFLICT DO NOTHING;

-- Verify
SELECT id, slug, type, status, version,
       left(html_content, 100) AS html_preview
FROM templates
WHERE slug = 'telegram-daily-summary-multi'
  AND tenant_id = '11111111-1111-1111-1111-111111111111';
