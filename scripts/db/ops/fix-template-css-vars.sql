-- =============================================================================
-- FIX: Atualiza html_content do template EMAIL_ALARM para usar CSS vars
--      em vez de cores hardcoded (#0D47A1 etc.)
--
-- Problema: template tinha cores hardcoded que ignoravam o tema do customer.
--           O engine já injeta :root { --color-primary: ... } mas o CSS do
--           template não usava var(--color-primary).
--
-- Solução: substituir as propriedades CSS estáticas por var(--color-xxx, fallback)
--
-- Aplicar em prod:
--   psql $DATABASE_URL -f scripts/db/ops/fix-template-css-vars.sql
-- =============================================================================

UPDATE templates
SET
  html_content = $HTML$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Alerta MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:620px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  .header { background:var(--color-primary,#0D47A1); padding:24px 32px; }
  .header h1 { margin:0; color:#fff; font-size:1.25rem; font-weight:600; letter-spacing:-0.3px; }
  .header .subtitle { color:rgba(255,255,255,0.75); font-size:0.85rem; margin-top:4px; }
  .badge-alarm { display:inline-block; background:var(--color-warning,#FF6F00); color:#fff; border-radius:4px; padding:2px 10px; font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-top:6px; }
  .summary { background:#FFF8E1; border-left:4px solid var(--color-warning,#FF6F00); padding:16px 24px; margin:0; }
  .summary p { margin:4px 0; color:#5D4037; font-size:0.9rem; }
  .summary strong { color:var(--color-error,#BF360C); }
  .content { padding:24px 32px; }
  .rule-block { border:1px solid #E3E8F0; border-radius:6px; margin-bottom:20px; overflow:hidden; }
  .rule-header { background:var(--color-surface-variant,#E8F0FE); padding:12px 16px; }
  .rule-header h3 { margin:0; color:var(--color-primary,#0D47A1); font-size:0.95rem; font-weight:600; }
  .rule-meta { color:#546E7A; font-size:0.82rem; margin-top:4px; }
  .rule-body { padding:12px 16px; }
  .rule-condition { display:inline-block; background:#FFF3E0; color:var(--color-warning,#E65100); border-radius:4px; padding:3px 10px; font-size:0.82rem; font-family:monospace; margin-bottom:10px; }
  .emails-row { font-size:0.82rem; color:#546E7A; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; font-size:0.83rem; }
  thead th { background:var(--color-secondary,#37474F); color:#fff; padding:8px 10px; text-align:left; font-weight:500; }
  tbody td { padding:7px 10px; border-bottom:1px solid #ECEFF1; color:#37474F; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr:hover td { background:#F5F7FA; }
  .status-online { color:var(--color-success,#2E7D32); font-weight:600; }
  .status-offline { color:var(--color-error,#C62828); font-weight:600; }
  .footer { background:#F5F7FA; border-top:1px solid #E3E8F0; padding:16px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.78rem; }
  .footer a { color:var(--color-primary,#0D47A1); text-decoration:none; }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="header">
    <h1>&#9888; Alerta de Alarme — MYIO</h1>
    <div class="subtitle">Monitoramento IoT em tempo real</div>
    <span class="badge-alarm">&#128680; Alarme Ativo</span>
  </div>

  <!-- Summary banner -->
  <div class="summary">
    <p>&#128202; <strong>{{summary.rulesCount}}</strong> rule(s) disparada(s)</p>
    <p>&#128268; <strong>{{summary.devicesCount}}</strong> dispositivo(s) afetado(s)</p>
    <p>&#128225; Gateway: <strong>{{gateway.name}}</strong> ({{gateway.type}})</p>
  </div>

  <!-- Rules -->
  <div class="content">
    <p style="color:#546E7A; font-size:0.88rem; margin-top:0;">Detalhamento por rule:</p>

    {{#each rules}}
    <div class="rule-block">
      <div class="rule-header">
        <h3>&#128680; {{rule.name}}</h3>
        <div class="rule-meta">{{rule.description}}</div>
      </div>
      <div class="rule-body">
        <div class="rule-condition">&#10095; Condição: {{rule.condition}}</div>
        <div class="emails-row">&#9993; Notificados: {{rule.emails}}</div>

        <table>
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Data/Hora</th>
            </tr>
          </thead>
          <tbody>
            {{#each rule.devices}}
            <tr>
              <td>{{device.name}}</td>
              <td><strong>{{device.value}}</strong></td>
              <td class="status-{{device.status}}">{{device.status}}</td>
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
    N&atilde;o responda este email. Para configurar alertas, acesse o painel.</p>
  </div>

</div>
</body>
</html>$HTML$,
  updated_at = now()
WHERE id = 'a1b2c3d4-0001-0001-0001-000000000001'
  AND slug = 'alarm-notification-v1';

-- Verificar
SELECT slug, type, status,
  CASE WHEN html_content LIKE '%var(--color-primary%' THEN 'OK — usa CSS vars' ELSE 'ERRO — ainda hardcoded' END AS css_status,
  updated_at
FROM templates
WHERE id = 'a1b2c3d4-0001-0001-0001-000000000001';
