-- ED-1243: seed the EMAIL_CENTRAL_OFFLINE template (Notificação de Central).
--
-- Idempotent:
--   1) upserts the template_types catalog row (label/icon for the UI dropdown);
--   2) inserts the tenant-default template only if it does not already exist
--      (guarded by NOT EXISTS on type OR slug, so re-runs and manual UI edits
--      are safe — an existing row is left untouched).
--
-- The email only actually uses this template once the alarm-backend renders
-- type EMAIL_CENTRAL_OFFLINE instead of EMAIL_ALARM in central-offline-notify.
-- The template renderer is a custom mini-engine (not Handlebars): {{#each}}
-- aliases each item by its singular name, so the render context is flat
-- (rules[].name, rules[].devices[].name), same shape the alarm side produces.

-- 0) Prod schema-drift fix: production templates.type carries a CHECK constraint
--    templates_type_check enumerating the allowed types, and EMAIL_CENTRAL_OFFLINE
--    was not in it (a fresh/local DB has no such check — plain varchar). Widen the
--    allowlist to the full template type set so the insert below is accepted.
--    Idempotent + drift-tolerant: only acts if the constraint exists; the widened
--    set is a strict superset of every type in use, so validation never rewrites.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'templates_type_check'
  ) THEN
    ALTER TABLE templates DROP CONSTRAINT templates_type_check;
    ALTER TABLE templates ADD CONSTRAINT templates_type_check
      CHECK ((type)::text = ANY (ARRAY[
        'EMAIL_ALARM','EMAIL_CENTRAL_OFFLINE','EMAIL_REPORT','EMAIL_WELCOME','RELEASE_NOTE','NOTIFICATION','INSIGHT',
        'TELEGRAM_ALARM_OPENED','TELEGRAM_ALARM_CLOSED','TELEGRAM_ALARM_ESCALATED','TELEGRAM_ALARM_ACKNOWLEDGED',
        'TELEGRAM_ALARM_SNOOZED','TELEGRAM_ALARM_DIGEST','TELEGRAM_DAILY_SUMMARY','TELEGRAM_DAILY_SUMMARY_MULTI'
      ]));
  END IF;
END $$;

-- 1) UI catalog row for the new type.
INSERT INTO template_types (type, label, description, icon, sort_order, active)
VALUES ('EMAIL_CENTRAL_OFFLINE', 'Notificação de Central', 'E-mail de central offline (sem coluna Valor)', 'router', 15, true)
ON CONFLICT (type) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      active = true,
      updated_at = now();

-- 2) Tenant-default template (customer_id NULL) for the MYIO platform tenant.
INSERT INTO templates (slug, tenant_id, customer_id, name, type, status, html_content, description)
SELECT
  'central-offline-notification-v1',
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'Notificação de Central (Central Offline) V1',
  'EMAIL_CENTRAL_OFFLINE',
  'ACTIVE',
  $tmpl$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Central Offline — MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:620px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  /* Email clients (Gmail, Outlook) do not reliably support CSS custom
     properties: an unresolved var() drops the whole declaration, so a
     white-on-colored element loses its background and turns white-on-white.
     Literal colors + inline styles on the critical elements below. */
  .header { background:#B71C1C; padding:24px 32px; }
  .header h1 { margin:0; color:#ffffff; font-size:1.25rem; font-weight:600; letter-spacing:-0.3px; }
  .header .subtitle { color:rgba(255,255,255,0.85); font-size:0.85rem; margin-top:4px; }
  .badge-offline { display:inline-block; background:#7F0000; color:#ffffff; border-radius:4px; padding:2px 10px; font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-top:6px; }
  .summary { background:#FFEBEE; border-left:4px solid #C62828; padding:16px 24px; margin:0; }
  .summary p { margin:4px 0; color:#4E342E; font-size:0.9rem; }
  .summary strong { color:#B71C1C; }
  .content { padding:24px 32px; }
  .rule-block { border:1px solid #E3E8F0; border-radius:6px; margin-bottom:20px; overflow:hidden; }
  .rule-header { background:#FDECEA; padding:12px 16px; }
  .rule-header h3 { margin:0; color:#B71C1C; font-size:0.95rem; font-weight:600; }
  .rule-meta { color:#546E7A; font-size:0.82rem; margin-top:4px; }
  .rule-body { padding:12px 16px; }
  .rule-condition { display:inline-block; background:#FFF3E0; color:#E65100; border-radius:4px; padding:3px 10px; font-size:0.82rem; font-family:monospace; margin-bottom:10px; }
  .emails-row { font-size:0.82rem; color:#546E7A; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; font-size:0.83rem; }
  thead th { background:#37474F; color:#ffffff; padding:8px 10px; text-align:left; font-weight:500; }
  tbody td { padding:7px 10px; border-bottom:1px solid #ECEFF1; color:#37474F; }
  tbody tr:last-child td { border-bottom:none; }
  .status-offline { color:#C62828; font-weight:600; }
  .footer { background:#F5F7FA; border-top:1px solid #E3E8F0; padding:16px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.78rem; }
  .footer a { color:#0D47A1; text-decoration:none; }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="header" style="background:#B71C1C;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.3px;">&#128308; Central Offline — MYIO</h1>
    <div class="subtitle" style="color:#f3dbdb;font-size:13px;margin-top:4px;">Monitoramento de conectividade das centrais</div>
    <span class="badge-offline" style="display:inline-block;background:#7F0000;color:#ffffff;border-radius:4px;padding:2px 10px;font-size:11px;font-weight:700;text-transform:uppercase;margin-top:6px;">&#128308; Central sem comunica&ccedil;&atilde;o</span>
  </div>

  <!-- Summary banner -->
  <div class="summary">
    <p>&#128225; Central: <strong>{{gateway.name}}</strong></p>
    <p>&#128202; <strong>{{summary.rulesCount}}</strong> Regra(s) de central offline</p>
  </div>

  <!-- Rules -->
  <div class="content">
    <p style="color:#546E7A; font-size:0.88rem; margin-top:0;">Detalhamento por regra:</p>

    {{#each rules}}
    <div class="rule-block">
      <div class="rule-header">
        <h3>&#128308; {{rule.name}}</h3>
        <div class="rule-meta">{{rule.description}}</div>
      </div>
      <div class="rule-body">
        <div class="rule-condition">&#10095; Condi&ccedil;&atilde;o: {{rule.condition}}</div>
        <div class="emails-row">&#9993; Notificados: {{rule.emails}}</div>

        <table>
          <thead>
            <tr>
              <th style="background:#37474F;color:#ffffff;padding:8px 10px;text-align:left;font-weight:500;">Central</th>
              <th style="background:#37474F;color:#ffffff;padding:8px 10px;text-align:left;font-weight:500;">Status</th>
              <th style="background:#37474F;color:#ffffff;padding:8px 10px;text-align:left;font-weight:500;">Desde</th>
            </tr>
          </thead>
          <tbody>
            {{#each rule.devices}}
            <tr>
              <td><strong>{{device.name}}</strong></td>
              <td class="status-offline">{{device.status}}</td>
              <td>{{device.timestamp}}</td>
            </tr>
            {{/each}}
          </tbody>
        </table>
      </div>
    </div>
    {{/each}}
  </div>

  <!-- Footer -->
  <div class="footer">
    <p>Email gerado automaticamente pela plataforma <a href="https://app.myio.com.br">MYIO</a>.<br />
    N&atilde;o responda este email. Para configurar alertas de central offline, acesse o painel.</p>
  </div>

</div>
</body>
</html>
$tmpl$,
  'Template V1 de central offline — inspirado no alarme, sem a coluna Valor'
WHERE NOT EXISTS (
  SELECT 1 FROM templates
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND customer_id IS NULL
    AND (type = 'EMAIL_CENTRAL_OFFLINE' OR slug = 'central-offline-notification-v1')
);
