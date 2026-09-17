-- ED-1244: seed the INCIDENT template (Notificação de Incidente / ingestion).
--
-- Idempotent:
--   0) widens the prod templates_type_check to include INCIDENT (same drift as
--      0082 — a fresh/local DB has no such check);
--   1) upserts the template_types catalog row (UI dropdown label/icon);
--   2) inserts the tenant-default template only if it does not already exist.
--
-- Admin notification for ingestion incidents (gap detected -> interpolated). The
-- render context is a 4-level tree, flat / singular-aliased for the custom
-- renderer: customers[].name -> customer.gateways[].name ->
-- gateway.devices[].name -> device.slots[].{day,slot,gap,value}.

-- 0) Widen the type CHECK constraint (drift-tolerant, only if present).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'templates_type_check'
  ) THEN
    ALTER TABLE templates DROP CONSTRAINT templates_type_check;
    ALTER TABLE templates ADD CONSTRAINT templates_type_check
      CHECK ((type)::text = ANY (ARRAY[
        'EMAIL_ALARM','EMAIL_CENTRAL_OFFLINE','EMAIL_REPORT','EMAIL_WELCOME','RELEASE_NOTE','NOTIFICATION','INSIGHT','INCIDENT',
        'TELEGRAM_ALARM_OPENED','TELEGRAM_ALARM_CLOSED','TELEGRAM_ALARM_ESCALATED','TELEGRAM_ALARM_ACKNOWLEDGED',
        'TELEGRAM_ALARM_SNOOZED','TELEGRAM_ALARM_DIGEST','TELEGRAM_DAILY_SUMMARY','TELEGRAM_DAILY_SUMMARY_MULTI'
      ]));
  END IF;
END $$;

-- 1) UI catalog row for the new type.
INSERT INTO template_types (type, label, description, icon, sort_order, active)
VALUES ('INCIDENT', 'Notificação de Incidente', 'Incidentes do Ingestion (customer→gateway→device→slot)', 'alert-triangle', 16, true)
ON CONFLICT (type) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description,
      icon = EXCLUDED.icon,
      active = true,
      updated_at = now();

-- 2) Tenant-default template (customer_id NULL) for the MYIO platform tenant.
INSERT INTO templates (slug, tenant_id, customer_id, name, type, status, html_content, description)
SELECT
  'incident-notification-v1',
  '11111111-1111-1111-1111-111111111111',
  NULL,
  'Notificação de Incidente (Ingestion) V1',
  'INCIDENT',
  'ACTIVE',
  $tmpl$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Incidente de Ingestão — MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:680px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  /* Email clients do not reliably support CSS custom properties — literal
     colors + inline styles on the critical (colored) elements below. */
  .header { background:#B45309; padding:24px 32px; }
  .header h1 { margin:0; color:#ffffff; font-size:1.25rem; font-weight:600; letter-spacing:-0.3px; }
  .header .subtitle { color:#fde8cf; font-size:0.85rem; margin-top:4px; }
  .badge { display:inline-block; background:#7C2D12; color:#ffffff; border-radius:4px; padding:2px 10px; font-size:0.72rem; font-weight:700; text-transform:uppercase; margin-top:6px; }
  .summary { background:#FEF3C7; border-left:4px solid #D97706; padding:16px 24px; margin:0; }
  .summary p { margin:4px 0; color:#4E342E; font-size:0.9rem; }
  .summary strong { color:#92400E; }
  .content { padding:18px 28px; }
  .customer-block { border:1px solid #E7D8C4; border-radius:8px; margin-bottom:18px; overflow:hidden; }
  .customer-header { background:#B45309; color:#ffffff; padding:10px 16px; font-size:0.92rem; font-weight:600; }
  .gw-block { padding:6px 14px 2px; }
  .gw-header { color:#92400E; font-size:0.86rem; font-weight:600; margin:10px 0 2px; }
  .dev-block { margin:6px 0 12px; }
  .dev-name { color:#37474F; font-size:0.82rem; font-weight:600; margin:0 0 4px; }
  table { width:100%; border-collapse:collapse; font-size:0.8rem; }
  thead th { background:#37474F; color:#ffffff; padding:6px 10px; text-align:left; font-weight:500; }
  tbody td { padding:6px 10px; border-bottom:1px solid #ECEFF1; color:#37474F; }
  tbody tr:last-child td { border-bottom:none; }
  code.slot { background:#EEF2F7; border-radius:3px; padding:1px 6px; font-family:monospace; font-size:0.76rem; }
  td.value { font-weight:600; color:#166534; }
  .footer { background:#F5F7FA; border-top:1px solid #E3E8F0; padding:16px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.78rem; }
  .footer a { color:#0D47A1; text-decoration:none; }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="header" style="background:#B45309;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">&#128736;&#65039; Incidentes</h1>
    <div class="subtitle" style="color:#fde8cf;font-size:13px;margin-top:4px;">Gaps de dados detectados e interpolados pelo Agente do Ingestion</div>
    <span class="badge" style="display:inline-block;background:#7C2D12;color:#ffffff;border-radius:4px;padding:2px 10px;font-size:11px;font-weight:700;text-transform:uppercase;margin-top:6px;">Gaps detectados</span>
    <div class="header-meta" style="margin-top:14px;color:#fde8cf;font-size:13px;">
      <div style="margin-bottom:8px;">&#128269; Origem: <strong style="color:#ffffff;">{{summary.origin}}</strong></div>
      <div>&#9993; Notificados: <strong style="color:#ffffff;">{{emails}}</strong></div>
    </div>
  </div>

  <!-- Summary -->
  <div class="summary">
    <p>&#128203; <strong>{{summary.customersCount}}</strong> cliente(s) &nbsp;·&nbsp; &#128225; <strong>{{summary.gatewaysCount}}</strong> gateway(s) &nbsp;·&nbsp; &#128268; <strong>{{summary.devicesCount}}</strong> device(s) &nbsp;·&nbsp; &#9202;&#65039; <strong>{{summary.slotsCount}}</strong> slot(s)</p>
    <p>&#128337; Detectado em: <strong>{{summary.detectedAt}}</strong></p>
  </div>

  <!-- Tree: customer -> gateway -> device -> slots -->
  <div class="content">
    {{#each customers}}
    <div class="customer-block">
      <div class="customer-header">&#127970; Cliente: {{customer.name}}</div>
      {{#each customer.gateways}}
      <div class="gw-block">
        <div class="gw-header">&#128225; Gateway: {{gateway.name}}</div>
        {{#if gateway.mac}}<div class="gw-info" style="font-style:italic;color:#a08a6a;font-size:12px;margin:0 0 1px;">&#8226; MAC: {{gateway.mac}}</div>{{/if}}
        {{#if gateway.ipv6}}<div class="gw-info" style="font-style:italic;color:#a08a6a;font-size:12px;margin:0 0 1px;">&#8226; IPv6: {{gateway.ipv6}}</div>{{/if}}
        {{#if gateway.uid}}<div class="gw-info" style="font-style:italic;color:#a08a6a;font-size:12px;margin:0 0 6px;">&#8226; UID: {{gateway.uid}}</div>{{/if}}
        {{#each gateway.devices}}
        <div class="dev-block">
          <div class="dev-name">&#128268; {{device.label}} <span style="font-style:italic;font-weight:400;color:#8a7a63;font-size:0.85em;">({{device.name}})</span></div>
          <table>
            <thead>
              <tr>
                <th style="background:#37474F;color:#ffffff;padding:6px 10px;text-align:left;font-weight:500;width:120px;">Hora</th>
                <th style="background:#37474F;color:#ffffff;padding:6px 10px;text-align:left;font-weight:500;">Valor interpolado</th>
              </tr>
            </thead>
            <tbody>
              {{#each device.slots}}
              <tr>
                <td><code class="slot">{{slot.slot}}</code></td>
                <td class="value">{{slot.value}}</td>
              </tr>
              {{/each}}
            </tbody>
          </table>
        </div>
        {{/each}}
      </div>
      {{/each}}
    </div>
    {{/each}}
  </div>

  <!-- Optional: Observação -->
  {{#if observation}}
  <div style="margin:0 28px 6px;padding:14px 16px;background:#F8FAFC;border:1px solid #E3E8F0;border-left:4px solid #64748B;border-radius:6px;">
    <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">&#128221; Observa&ccedil;&atilde;o</div>
    <div style="font-size:13px;color:#37474F;line-height:1.5;">{{observation}}</div>
  </div>
  {{/if}}

  <!-- Optional: Ordens de Serviço -->
  {{#if workOrders}}
  <div style="margin:12px 28px 6px;padding:14px 16px;background:#EFF6FF;border:1px solid #DBEAFE;border-left:4px solid #2563EB;border-radius:6px;">
    <div style="font-size:12px;font-weight:700;color:#1D4ED8;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;">&#128203; Ordens de Servi&ccedil;o geradas</div>
    {{#each workOrders}}
    <div style="font-size:13px;color:#37474F;padding:5px 0;border-top:1px solid #DBEAFE;">
      <strong>{{workOrder.number}}</strong> &mdash; {{workOrder.title}} <span style="color:#64748B;">({{workOrder.status}})</span>
    </div>
    {{/each}}
  </div>
  {{/if}}

  <!-- Footer -->
  <div class="footer">
    <p>Email gerado automaticamente pela plataforma <a href="https://app.myio.com.br">MYIO</a>.<br />
    Notifica&ccedil;&atilde;o administrativa de incidentes do Ingestion. N&atilde;o responda este email.</p>
  </div>

</div>
</body>
</html>
$tmpl$,
  'Template V1 de incidentes do Ingestion — árvore customer→gateway→device→slot, valor interpolado'
WHERE NOT EXISTS (
  SELECT 1 FROM templates
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND customer_id IS NULL
    AND (type = 'INCIDENT' OR slug = 'incident-notification-v1')
);
