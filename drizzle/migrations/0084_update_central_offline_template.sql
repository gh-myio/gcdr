-- ED-1244: refresh the central-offline template HTML.
-- Adds: notified emails in the header ({{#if emails}}), optional central
-- MAC/IPv6/UID ({{#if gateway.mac/ipv6/uid}}), and optional final sections
-- Observação ({{#if observation}}) and Ordens de Serviço ({{#if workOrders}}).
-- The per-rule "Notificados: {{rule.emails}}" line is intentionally kept.
--
-- The template already exists (seeded by 0082) — this UPDATEs its html_content
-- in place. Idempotent: re-running sets the same content. All new fields are
-- optional, so the alarm-backend render context stays backward-compatible.
UPDATE templates
SET html_content = $tmpl$<!DOCTYPE html>
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
    {{#if emails}}<div style="margin-top:14px;color:#f3dbdb;font-size:13px;">&#9993; Notificados: <strong style="color:#ffffff;">{{emails}}</strong></div>{{/if}}
    <div style="margin-top:8px;color:#f3dbdb;font-size:13px;">&#128308; <strong style="color:#ffffff;">{{summary.centralsCount}}</strong> central(is) offline</div>
  </div>

  <!-- Summary banner -->
  <div class="summary">
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

        <table>
          <thead>
            <tr>
              <th style="background:#37474F;color:#ffffff;padding:8px 10px;text-align:left;font-weight:500;">Central</th>
              <th style="background:#37474F;color:#ffffff;padding:8px 10px;text-align:left;font-weight:500;">Status</th>
              <th style="background:#37474F;color:#ffffff;padding:8px 10px;text-align:left;font-weight:500;">Desde</th>
            </tr>
          </thead>
          <tbody>
            {{#each rule.centrals}}
            <tr>
              <td>
                <strong>{{central.label}}</strong> <span style="font-style:italic;font-weight:400;color:#8a6d6d;font-size:0.85em;">({{central.name}})</span>
                {{#if central.mac}}<div style="font-style:italic;color:#8a6d6d;font-size:11px;margin-top:2px;">&#8226; MAC: {{central.mac}}</div>{{/if}}
                {{#if central.ipv6}}<div style="font-style:italic;color:#8a6d6d;font-size:11px;">&#8226; IPv6: {{central.ipv6}}</div>{{/if}}
                {{#if central.uid}}<div style="font-style:italic;color:#8a6d6d;font-size:11px;">&#8226; UID: {{central.uid}}</div>{{/if}}
              </td>
              <td class="status-offline">{{central.status}}</td>
              <td>{{central.timestamp}}</td>
            </tr>
            {{/each}}
          </tbody>
        </table>
      </div>
    </div>
    {{/each}}
  </div>

  <!-- Optional: Observação -->
  {{#if observation}}
  <div style="margin:0 32px 6px;padding:14px 16px;background:#F8FAFC;border:1px solid #E3E8F0;border-left:4px solid #64748B;border-radius:6px;">
    <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">&#128221; Observa&ccedil;&atilde;o</div>
    <div style="font-size:13px;color:#37474F;line-height:1.5;">{{observation}}</div>
  </div>
  {{/if}}

  <!-- Optional: Ordens de Serviço -->
  {{#if workOrders}}
  <div style="margin:12px 32px 6px;padding:14px 16px;background:#EFF6FF;border:1px solid #DBEAFE;border-left:4px solid #2563EB;border-radius:6px;">
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
    N&atilde;o responda este email. Para configurar alertas de central offline, acesse o painel.</p>
  </div>

</div>
</body>
</html>
$tmpl$,
    updated_at = now()
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  AND customer_id IS NULL
  AND type = 'EMAIL_CENTRAL_OFFLINE'
  AND slug = 'central-offline-notification-v1';
