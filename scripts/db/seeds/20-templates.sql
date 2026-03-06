-- =============================================================================
-- SEED: HTML Templates (RFC-0021)
-- =============================================================================
-- 6 templates realistas com HTML completo:
--   1. EMAIL_ALARM   — notificação de alarme          (ACTIVE)
--   2. EMAIL_REPORT  — relatório periódico             (DRAFT)
--   3. EMAIL_WELCOME — boas-vindas / reset de senha    (ACTIVE)
--   4. RELEASE_NOTE  — comunicado de nova feature      (DRAFT)
--   5. NOTIFICATION  — notificação avulsa de sistema   (DRAFT)
--   6. INSIGHT       — resumo de insights e métricas   (DRAFT)
--
-- Payload contract: docs/EMAIL-SENDER-PAYLOAD-CONTRACT.md
-- Tag catalog:      GET /templates/tag-catalog?type=<TYPE>
-- Tenant:           11111111-1111-1111-1111-111111111111
-- =============================================================================

-- =========================================================================
-- 1. EMAIL_ALARM — Notificação de Alarme (ACTIVE)
-- =========================================================================
INSERT INTO templates (id, slug, tenant_id, name, type, status, html_content, description, version, created_by)
VALUES (
    'a1b2c3d4-0001-0001-0001-000000000001',
    'alarm-notification-v1',
    '11111111-1111-1111-1111-111111111111',
    'Notificação de Alarme',
    'EMAIL_ALARM',
    'ACTIVE',
    $HTML$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Alerta MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:620px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  .header { background:#0D47A1; padding:24px 32px; }
  .header h1 { margin:0; color:#fff; font-size:1.25rem; font-weight:600; letter-spacing:-0.3px; }
  .header .subtitle { color:#90CAF9; font-size:0.85rem; margin-top:4px; }
  .badge-alarm { display:inline-block; background:#FF6F00; color:#fff; border-radius:4px; padding:2px 10px; font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-top:6px; }
  .summary { background:#FFF8E1; border-left:4px solid #FF6F00; padding:16px 24px; margin:0; }
  .summary p { margin:4px 0; color:#5D4037; font-size:0.9rem; }
  .summary strong { color:#BF360C; }
  .content { padding:24px 32px; }
  .rule-block { border:1px solid #E3E8F0; border-radius:6px; margin-bottom:20px; overflow:hidden; }
  .rule-header { background:#E8F0FE; padding:12px 16px; }
  .rule-header h3 { margin:0; color:#0D47A1; font-size:0.95rem; font-weight:600; }
  .rule-meta { color:#546E7A; font-size:0.82rem; margin-top:4px; }
  .rule-body { padding:12px 16px; }
  .rule-condition { display:inline-block; background:#FFF3E0; color:#E65100; border-radius:4px; padding:3px 10px; font-size:0.82rem; font-family:monospace; margin-bottom:10px; }
  .emails-row { font-size:0.82rem; color:#546E7A; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; font-size:0.83rem; }
  thead th { background:#37474F; color:#fff; padding:8px 10px; text-align:left; font-weight:500; }
  tbody td { padding:7px 10px; border-bottom:1px solid #ECEFF1; color:#37474F; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr:hover td { background:#F5F7FA; }
  .status-online { color:#2E7D32; font-weight:600; }
  .status-offline { color:#C62828; font-weight:600; }
  .footer { background:#F5F7FA; border-top:1px solid #E3E8F0; padding:16px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.78rem; }
  .footer a { color:#0D47A1; text-decoration:none; }
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
    'Template padrão para notificações de alarme disparadas pelo motor de rules',
    1,
    NULL
) ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 2. EMAIL_REPORT — Relatório Periódico (DRAFT)
-- =========================================================================
INSERT INTO templates (id, slug, tenant_id, name, type, status, html_content, description, version, created_by)
VALUES (
    'a1b2c3d4-0001-0001-0001-000000000002',
    'periodic-report-v1',
    '11111111-1111-1111-1111-111111111111',
    'Relatório Periódico',
    'EMAIL_REPORT',
    'DRAFT',
    $HTML$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Relatório MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:640px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  .header { background:#1B5E20; padding:24px 32px; }
  .header h1 { margin:0; color:#fff; font-size:1.2rem; font-weight:600; }
  .header .meta { color:#A5D6A7; font-size:0.83rem; margin-top:6px; }
  .kpi-row { display:flex; gap:0; border-bottom:1px solid #E3E8F0; }
  .kpi { flex:1; text-align:center; padding:20px 12px; border-right:1px solid #E3E8F0; }
  .kpi:last-child { border-right:none; }
  .kpi-value { font-size:1.8rem; font-weight:700; color:#1B5E20; line-height:1; }
  .kpi-label { font-size:0.76rem; color:#78909C; margin-top:4px; text-transform:uppercase; letter-spacing:0.5px; }
  .content { padding:24px 32px; }
  .section-title { font-size:0.88rem; font-weight:700; color:#37474F; text-transform:uppercase; letter-spacing:0.5px; margin:0 0 12px; border-bottom:2px solid #E8F5E9; padding-bottom:6px; }
  table { width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:20px; }
  thead th { background:#E8F5E9; color:#1B5E20; padding:8px 10px; text-align:left; font-weight:600; }
  tbody td { padding:8px 10px; border-bottom:1px solid #F5F5F5; color:#37474F; }
  .footer { background:#F5F7FA; border-top:1px solid #E3E8F0; padding:14px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.78rem; }
</style>
</head>
<body>
<div class="wrapper">

  <div class="header">
    <h1>&#128202; {{report.title}}</h1>
    <div class="meta">
      Cliente: <strong>{{customer.name}}</strong> &nbsp;|&nbsp;
      Per&iacute;odo: {{report.period}} &nbsp;|&nbsp;
      Gerado em: {{report.generatedAt}}
    </div>
  </div>

  <!-- KPIs -->
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-value">{{summary.totalAlarms}}</div>
      <div class="kpi-label">Alarmes</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">{{summary.activeDevices}}</div>
      <div class="kpi-label">Dispositivos ativos</div>
    </div>
  </div>

  <div class="content">
    <p class="section-title">Resumo do per&iacute;odo</p>
    <table>
      <thead>
        <tr><th>Indicador</th><th>Valor</th></tr>
      </thead>
      <tbody>
        {{#each items}}
        <tr>
          <td>{{item.label}}</td>
          <td><strong>{{item.value}}</strong></td>
        </tr>
        {{/each}}
      </tbody>
    </table>
  </div>

  <div class="footer">
    <p>Relat&oacute;rio autom&aacute;tico gerado pela plataforma MYIO. N&atilde;o responda este email.</p>
  </div>

</div>
</body>
</html>$HTML$,
    'Template para relatórios periódicos (mensal, semanal). Status DRAFT — personalizar antes de ativar.',
    1,
    NULL
) ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 3. EMAIL_WELCOME — Boas-vindas (ACTIVE)
-- =========================================================================
INSERT INTO templates (id, slug, tenant_id, name, type, status, html_content, description, version, created_by)
VALUES (
    'a1b2c3d4-0001-0001-0001-000000000003',
    'welcome-email-v1',
    '11111111-1111-1111-1111-111111111111',
    'Boas-vindas ao MYIO',
    'EMAIL_WELCOME',
    'ACTIVE',
    $HTML$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Bem-vindo ao MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:580px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  .header { background:linear-gradient(135deg,#0D47A1 0%,#1565C0 100%); padding:36px 32px; text-align:center; }
  .header h1 { margin:0; color:#fff; font-size:1.5rem; font-weight:700; }
  .header .tagline { color:#90CAF9; font-size:0.9rem; margin-top:6px; }
  .hero { text-align:center; padding:32px 32px 8px; }
  .hero h2 { margin:0 0 8px; color:#1A1F36; font-size:1.15rem; }
  .hero p { color:#546E7A; font-size:0.9rem; margin:0; line-height:1.6; }
  .content { padding:8px 32px 24px; }
  .step { display:flex; gap:14px; margin-bottom:18px; align-items:flex-start; }
  .step-num { background:#0D47A1; color:#fff; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.85rem; flex-shrink:0; margin-top:2px; }
  .step-text h4 { margin:0 0 3px; color:#1A1F36; font-size:0.9rem; }
  .step-text p { margin:0; color:#546E7A; font-size:0.83rem; }
  .cta { text-align:center; padding:8px 32px 32px; }
  .btn { display:inline-block; background:#0D47A1; color:#fff; text-decoration:none; padding:14px 32px; border-radius:6px; font-weight:600; font-size:0.95rem; letter-spacing:0.2px; }
  .btn:hover { background:#1565C0; }
  .expiry { font-size:0.78rem; color:#90A4AE; margin-top:10px; }
  .divider { border:none; border-top:1px solid #E3E8F0; margin:0 32px; }
  .footer { padding:16px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.78rem; line-height:1.6; }
</style>
</head>
<body>
<div class="wrapper">

  <div class="header">
    <h1>&#128075; Bem-vindo ao {{platform.name}}!</h1>
    <div class="tagline">Plataforma de Gest&atilde;o IoT</div>
  </div>

  <div class="hero">
    <h2>Ol&aacute;, {{user.name}}!</h2>
    <p>Sua conta foi criada com sucesso na empresa <strong>{{customer.name}}</strong>.<br />
    Clique no bot&atilde;o abaixo para definir sua senha e ativar o acesso.</p>
  </div>

  <div class="content">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">
        <h4>Ative sua conta</h4>
        <p>Clique em "Ativar minha conta" e defina uma senha segura.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">
        <h4>Explore o painel</h4>
        <p>Visualize ativos, dispositivos e alarmes em tempo real.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">
        <h4>Configure alertas</h4>
        <p>Crie rules e receba notifica&ccedil;&otilde;es quando limites forem atingidos.</p>
      </div>
    </div>
  </div>

  <div class="cta">
    <a href="{{activation.link}}" class="btn">&#9889; Ativar minha conta</a>
    <div class="expiry">&#128337; Link v&aacute;lido at&eacute; {{activation.expiresAt}}</div>
  </div>

  <hr class="divider" />

  <div class="footer">
    <p>
      Seu email de acesso: <strong>{{user.email}}</strong><br />
      Acesse em: <a href="{{platform.url}}" style="color:#0D47A1;">{{platform.url}}</a><br /><br />
      Se voc&ecirc; n&atilde;o solicitou este acesso, ignore este email.
    </p>
  </div>

</div>
</body>
</html>$HTML$,
    'Email de boas-vindas enviado ao criar um novo usuário. Link de ativação para definir senha.',
    1,
    NULL
) ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 4. RELEASE_NOTE — Comunicado de Nova Feature (DRAFT)
-- =========================================================================
INSERT INTO templates (id, slug, tenant_id, name, type, status, html_content, description, version, created_by)
VALUES (
    'a1b2c3d4-0001-0001-0001-000000000004',
    'release-note-v1',
    '11111111-1111-1111-1111-111111111111',
    'Release Note — Nova Feature',
    'RELEASE_NOTE',
    'DRAFT',
    $HTML$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Release Note MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:640px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  .header { background:linear-gradient(135deg,#311B92 0%,#512DA8 100%); padding:28px 32px; }
  .header .badge { display:inline-block; background:rgba(255,255,255,0.2); color:#EDE7F6; font-size:0.75rem; font-weight:600; padding:3px 12px; border-radius:20px; margin-bottom:12px; }
  .header h1 { margin:0 0 6px; color:#fff; font-size:1.2rem; font-weight:700; }
  .header .sub { color:#CE93D8; font-size:0.83rem; }
  .hero { padding:28px 32px 20px; border-bottom:1px solid #EDE7F6; }
  .hero h2 { margin:0 0 6px; color:#1A1F36; font-size:1.1rem; font-weight:700; }
  .hero .subtitle { color:#7E57C2; font-size:0.85rem; font-weight:600; margin-bottom:12px; }
  .hero p { margin:0; color:#546E7A; font-size:0.88rem; line-height:1.65; }
  .two-col { display:flex; gap:0; }
  .col-left { flex:1; padding:24px 32px; }
  .col-right { width:200px; background:#F3E5F5; padding:24px; display:flex; flex-direction:column; gap:16px; }
  .section-label { font-size:0.75rem; font-weight:700; color:#7E57C2; text-transform:uppercase; letter-spacing:0.6px; margin-bottom:10px; }
  .format-item { display:flex; gap:10px; align-items:flex-start; margin-bottom:12px; }
  .format-badge { background:#7E57C2; color:#fff; border-radius:4px; padding:2px 8px; font-size:0.72rem; font-weight:700; flex-shrink:0; margin-top:2px; }
  .format-desc { color:#546E7A; font-size:0.8rem; }
  .step-row { display:flex; gap:10px; align-items:flex-start; margin-bottom:10px; }
  .step-num { background:#512DA8; color:#fff; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:0.72rem; font-weight:700; flex-shrink:0; margin-top:1px; }
  .step-text { color:#37474F; font-size:0.83rem; line-height:1.5; }
  .highlight-panel { background:#EDE7F6; border-radius:6px; padding:10px 12px; }
  .highlight-label { font-size:0.72rem; color:#7E57C2; font-weight:600; }
  .highlight-metric { font-size:1.5rem; font-weight:700; color:#311B92; line-height:1.2; margin:4px 0; }
  .highlight-item { padding:6px 0; border-bottom:1px solid #D1C4E9; }
  .highlight-item:last-child { border-bottom:none; }
  .hi-label { font-size:0.72rem; color:#7E57C2; font-weight:600; }
  .hi-value { font-size:0.88rem; font-weight:700; color:#311B92; }
  .hi-desc { font-size:0.72rem; color:#9575CD; }
  .footer { background:#F5F7FA; border-top:1px solid #E3E8F0; padding:14px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.78rem; }
  .footer a { color:#512DA8; text-decoration:none; }
</style>
</head>
<body>
<div class="wrapper">

  <div class="header">
    <div class="badge">&#128640; {{version}} &nbsp;|&nbsp; {{period}}</div>
    <h1>{{featureTitle}}</h1>
    <div class="sub">{{moduleName}}</div>
  </div>

  <div class="hero">
    <h2>{{featureTitle}}</h2>
    <div class="subtitle">{{featureSubtitle}}</div>
    <p>{{overviewText}}</p>
  </div>

  <div class="two-col">
    <div class="col-left">

      <div class="section-label">Formatos disponíveis</div>
      {{#each formats}}
      <div class="format-item">
        <span class="format-badge">{{format.label}}</span>
        <span class="format-desc">{{format.description}}</span>
      </div>
      {{/each}}

      <div class="section-label" style="margin-top:20px;">Como usar</div>
      {{#each steps}}
      <div class="step-row">
        <div class="step-num">{{step.number}}</div>
        <div class="step-text">{{step.text}}</div>
      </div>
      {{/each}}

    </div>
    <div class="col-right">

      <div class="highlight-panel">
        <div class="highlight-label">{{highlightPanelLabel}}</div>
        <div class="highlight-metric">{{highlightMetric}}</div>
      </div>

      {{#each highlights}}
      <div class="highlight-item">
        <div class="hi-label">{{highlight.label}}</div>
        <div class="hi-value">{{highlight.value}}</div>
        <div class="hi-desc">{{highlight.description}}</div>
      </div>
      {{/each}}

    </div>
  </div>

  <div class="footer">
    <p>Voc&ecirc; est&aacute; recebendo este email pois &eacute; usu&aacute;rio da <a href="https://app.myio.com.br">plataforma MYIO</a>.</p>
  </div>

</div>
</body>
</html>$HTML$,
    'Release note de nova feature. Status DRAFT — revisar textos antes de ativar.',
    1,
    NULL
) ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 5. NOTIFICATION — Notificação Avulsa de Sistema (DRAFT)
-- =========================================================================
INSERT INTO templates (id, slug, tenant_id, name, type, status, html_content, description, version, created_by)
VALUES (
    'a1b2c3d4-0001-0001-0001-000000000005',
    'system-notification-v1',
    '11111111-1111-1111-1111-111111111111',
    'Notificação de Sistema',
    'NOTIFICATION',
    'DRAFT',
    $HTML$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Notificação MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:560px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  .header { background:#0D47A1; padding:20px 28px; display:flex; align-items:center; gap:12px; }
  .header h1 { margin:0; color:#fff; font-size:1rem; font-weight:600; }
  .level-bar { height:4px; }
  .level-INFO    { background:#1976D2; }
  .level-SUCCESS { background:#2E7D32; }
  .level-WARNING { background:#F57F17; }
  .level-ERROR   { background:#C62828; }
  .body { padding:28px 32px; }
  .level-badge { display:inline-block; border-radius:4px; padding:3px 12px; font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:16px; }
  .badge-INFO    { background:#E3F2FD; color:#0D47A1; }
  .badge-SUCCESS { background:#E8F5E9; color:#2E7D32; }
  .badge-WARNING { background:#FFF8E1; color:#F57F17; }
  .badge-ERROR   { background:#FFEBEE; color:#C62828; }
  .title { font-size:1.05rem; font-weight:700; color:#1A1F36; margin:0 0 10px; }
  .message { font-size:0.9rem; color:#546E7A; line-height:1.7; margin:0 0 24px; }
  .cta { text-align:center; margin-bottom:8px; }
  .btn { display:inline-block; background:#0D47A1; color:#fff; text-decoration:none; padding:12px 28px; border-radius:6px; font-weight:600; font-size:0.9rem; }
  .footer { background:#F5F7FA; border-top:1px solid #E3E8F0; padding:14px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.76rem; }
</style>
</head>
<body>
<div class="wrapper">

  <div class="header">
    <h1>&#128276; {{platform.name}} — Notificação</h1>
  </div>
  <div class="level-bar level-{{notification.level}}"></div>

  <div class="body">
    <span class="level-badge badge-{{notification.level}}">{{notification.level}}</span>
    <div class="title">{{notification.title}}</div>
    <div class="message">Ol&aacute;, <strong>{{user.name}}</strong>.<br /><br />{{notification.body}}</div>
    <div class="cta">
      <a href="{{notification.actionUrl}}" class="btn">{{notification.actionLabel}}</a>
    </div>
  </div>

  <div class="footer">
    <p>Notifica&ccedil;&atilde;o autom&aacute;tica de <strong>{{customer.name}}</strong> via plataforma {{platform.name}}.</p>
  </div>

</div>
</body>
</html>$HTML$,
    'Notificação avulsa de sistema (INFO, WARNING, ERROR, SUCCESS). Status DRAFT — ativar após validação.',
    1,
    NULL
) ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 6. INSIGHT — Resumo de Insights e Métricas (DRAFT)
-- =========================================================================
INSERT INTO templates (id, slug, tenant_id, name, type, status, html_content, description, version, created_by)
VALUES (
    'a1b2c3d4-0001-0001-0001-000000000006',
    'insights-summary-v1',
    '11111111-1111-1111-1111-111111111111',
    'Resumo de Insights',
    'INSIGHT',
    'DRAFT',
    $HTML$<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Insights MYIO</title>
<style>
  body { margin:0; padding:0; background:#f0f2f5; font-family: Inter, Arial, sans-serif; }
  .wrapper { max-width:620px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.1); }
  .header { background:linear-gradient(135deg,#004D40 0%,#00796B 100%); padding:24px 32px; }
  .header h1 { margin:0 0 4px; color:#fff; font-size:1.15rem; font-weight:700; }
  .header .meta { color:#80CBC4; font-size:0.83rem; }
  .summary-block { background:#E0F2F1; border-left:4px solid #00796B; padding:16px 24px; }
  .summary-block p { margin:0; color:#004D40; font-size:0.88rem; line-height:1.65; }
  .content { padding:24px 32px; }
  .section-label { font-size:0.75rem; font-weight:700; color:#00796B; text-transform:uppercase; letter-spacing:0.6px; margin:0 0 12px; border-bottom:2px solid #E0F2F1; padding-bottom:6px; }
  .metrics-grid { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:24px; }
  .metric-card { flex:1; min-width:130px; border:1px solid #E0F2F1; border-radius:6px; padding:14px 16px; }
  .metric-label { font-size:0.75rem; color:#546E7A; margin-bottom:4px; }
  .metric-value { font-size:1.4rem; font-weight:700; color:#004D40; line-height:1; }
  .metric-unit { font-size:0.75rem; color:#78909C; font-weight:400; margin-left:2px; }
  .metric-trend { font-size:0.75rem; font-weight:600; margin-top:4px; }
  .trend-UP     { color:#2E7D32; }
  .trend-DOWN   { color:#C62828; }
  .trend-STABLE { color:#546E7A; }
  .rec-item { border:1px solid #E0F2F1; border-radius:6px; padding:14px 16px; margin-bottom:10px; }
  .rec-title { font-weight:600; color:#004D40; font-size:0.88rem; margin-bottom:4px; }
  .rec-text { color:#546E7A; font-size:0.83rem; line-height:1.55; }
  .footer { background:#F5F7FA; border-top:1px solid #E3E8F0; padding:14px 32px; text-align:center; }
  .footer p { margin:0; color:#90A4AE; font-size:0.78rem; }
</style>
</head>
<body>
<div class="wrapper">

  <div class="header">
    <h1>&#128200; {{insight.title}}</h1>
    <div class="meta">{{customer.name}} &nbsp;|&nbsp; {{insight.period}}</div>
  </div>

  <div class="summary-block">
    <p>{{insight.summary}}</p>
  </div>

  <div class="content">

    <div class="section-label">M&eacute;tricas do per&iacute;odo</div>
    <div class="metrics-grid">
      {{#each metrics}}
      <div class="metric-card">
        <div class="metric-label">{{metric.label}}</div>
        <div class="metric-value">{{metric.value}}<span class="metric-unit">{{metric.unit}}</span></div>
        <div class="metric-trend trend-{{metric.trend}}">
          {{metric.trend}}
        </div>
      </div>
      {{/each}}
    </div>

    <div class="section-label">Recomenda&ccedil;&otilde;es</div>
    {{#each recommendations}}
    <div class="rec-item">
      <div class="rec-title">&#128161; {{recommendation.title}}</div>
      <div class="rec-text">{{recommendation.text}}</div>
    </div>
    {{/each}}

  </div>

  <div class="footer">
    <p>Insights gerados automaticamente pela plataforma MYIO para {{customer.name}}.</p>
  </div>

</div>
</body>
</html>$HTML$,
    'Resumo de insights e métricas do período. Status DRAFT — ativar após validação com o time de produto.',
    1,
    NULL
) ON CONFLICT (id) DO NOTHING;

-- Verify
SELECT id, slug, type, status, version, LENGTH(html_content) AS html_bytes FROM templates ORDER BY type;
