-- Seed: Release Note HTML template (RELEASE_NOTE type)
-- Inspired by: MYIO_Release_Note_Export-v0.1.428.pdf
-- Template variables:
--   {{version}}, {{period}}, {{moduleName}}, {{featureTitle}}, {{featureSubtitle}},
--   {{overviewText}}, {{highlightPanelLabel}}, {{highlightMetric}}
--   {{#each formats}} → {{format.label}}, {{format.description}}
--   {{#each panels}}  → {{panel.name}}, {{panel.deviceCount}}
--   {{#each steps}}   → {{step.number}}, {{step.text}}
--   {{#each highlights}} → {{highlight.label}}, {{highlight.value}}, {{highlight.description}}

DO $$
DECLARE
  v_tenant_id UUID := '11111111-1111-1111-1111-111111111111';
  v_slug      TEXT := 'release-note-v1';
BEGIN

  IF EXISTS (SELECT 1 FROM templates WHERE tenant_id = v_tenant_id AND slug = v_slug) THEN
    RAISE NOTICE 'Template % already exists — skipping', v_slug;
    RETURN;
  END IF;

  INSERT INTO templates (
    slug, tenant_id, name, type, status, description, html_content, created_by
  ) VALUES (
    v_slug,
    v_tenant_id,
    'MYIO Release Note',
    'RELEASE_NOTE',
    'ACTIVE',
    'Template de e-mail para comunicado de novas funcionalidades e releases da plataforma MYIO. Estilo visual roxo degradê inspirado no PDF de Release Note.',
    $HTML$<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MYIO Release Note {{version}}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #F8F6FF; font-family: Arial, Helvetica, sans-serif; }
    .wrapper { max-width: 680px; margin: 0 auto; background-color: #F8F6FF; }
    /* Header */
    .header { background: linear-gradient(135deg, #4E1081 0%, #6D28D9 60%, #7C3AED 100%); padding: 0; }
    .header-inner { padding: 18px 28px 14px 28px; }
    .brand { font-size: 26px; font-weight: bold; color: #FFFFFF; letter-spacing: 3px; line-height: 1; }
    .brand-sub { font-size: 9px; color: #DDD6FE; margin-top: 3px; }
    .badge { display: inline-block; background: #5B21B5; border: 1px solid #A78BFA; border-radius: 20px; padding: 5px 14px; font-size: 10px; font-weight: bold; color: #EDE9FE; white-space: nowrap; }
    .badge-period { font-size: 9px; color: #DDD6FE; margin-top: 5px; text-align: right; }
    /* Feature title */
    .feature-zone { padding: 22px 28px 14px 28px; background: #F8F6FF; }
    .feature-title { font-size: 20px; font-weight: bold; color: #1E1B4B; line-height: 1.25; }
    .feature-sub { font-size: 10px; color: #6B7280; margin-top: 5px; }
    /* Body columns */
    .columns { padding: 0 20px 20px 20px; background: #F8F6FF; }
    /* Cards */
    .card { background: #FFFFFF; border: 1px solid #E4E2F4; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; }
    .card-title { font-size: 11px; font-weight: bold; color: #1E1B4B; margin-bottom: 10px; }
    .card-body { font-size: 9px; color: #6B7280; line-height: 1.65; }
    /* Format row */
    .fmt-label { display: inline-block; background: #EDE8FD; color: #6B21A8; font-size: 9px; font-weight: bold; padding: 3px 8px; border-radius: 4px; min-width: 28px; text-align: center; }
    .fmt-desc { font-size: 8.5px; color: #6B7280; }
    /* Panel row */
    .panel-name { font-size: 9px; font-weight: bold; color: #1E1B4B; }
    .panel-count { font-size: 8px; color: #6B7280; }
    /* Steps card */
    .card-steps { background: #EDE8FD; border: 1px solid #DDD6FD; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; }
    .card-steps .card-title { color: #3B0764; }
    .step-num { display: inline-block; width: 18px; height: 18px; background: #7C3AED; border-radius: 50%; text-align: center; line-height: 18px; font-size: 9px; font-weight: bold; color: #FFFFFF; }
    .step-text { font-size: 9px; color: #1E1B4B; }
    /* Right panel card */
    .card-right { background: #FFFFFF; border: 1px solid #E4E2F4; border-radius: 8px; padding: 18px; }
    .metric-label { font-size: 10px; font-weight: bold; color: #1E1B4B; }
    .metric-value { font-size: 26px; font-weight: bold; color: #9333EA; margin: 6px 0 14px 0; line-height: 1; }
    /* Feature highlight box */
    .feat-box { background: #F4F2FF; border: 1px solid #C4B5FD; border-radius: 6px; padding: 14px; margin-bottom: 14px; }
    .feat-badge { display: inline-block; background: #7C3AED; color: #FFFFFF; font-size: 8px; font-weight: bold; padding: 3px 8px; border-radius: 4px; margin-bottom: 8px; letter-spacing: 1px; }
    .feat-title { font-size: 11px; font-weight: bold; color: #1E1B4B; margin-bottom: 4px; }
    .feat-sub { font-size: 9px; color: #6B7280; margin-bottom: 12px; }
    .btn-export { display: inline-block; border: 1px solid #7C3AED; color: #6B21A8; font-size: 9px; font-weight: bold; padding: 5px 14px; border-radius: 4px; margin-right: 6px; background: #FFFFFF; }
    /* Highlight rows */
    .hl-label { font-size: 9px; font-weight: bold; color: #1E1B4B; }
    .hl-value { font-size: 13px; font-weight: bold; color: #9333EA; text-align: right; }
    .hl-desc { font-size: 8px; color: #6B7280; padding-top: 2px; }
    .hl-divider { border: none; border-top: 1px solid #E4E2F4; margin: 10px 0; }
    /* Footer */
    .footer { background: linear-gradient(135deg, #4E1081 0%, #6D28D9 60%, #7C3AED 100%); padding: 12px 28px; }
    .footer-left { font-size: 8px; color: #DDD6FE; }
    .footer-center { font-size: 9px; font-weight: bold; color: #FFFFFF; text-align: center; }
    .footer-right { font-size: 8px; color: #DDD6FE; text-align: right; }
  </style>
</head>
<body>
<div class="wrapper">

  <!-- ═══════════════════════════════════════════════════ HEADER -->
  <div class="header">
    <div class="header-inner">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr valign="middle">
          <td>
            <div class="brand">MYIO</div>
            <div class="brand-sub">Plataforma de Telemetria e Monitoramento &nbsp;|&nbsp; Comunicado</div>
          </td>
          <td align="right">
            <span class="badge">RELEASE NOTE &nbsp;{{version}}</span>
            <div class="badge-period">{{period}} &nbsp;|&nbsp; {{moduleName}}</div>
          </td>
        </tr>
      </table>
    </div>
    <!-- green accent bar -->
    <div style="height:4px;background:#21B554;"></div>
  </div>

  <!-- ═══════════════════════════════════════════════════ FEATURE TITLE -->
  <div class="feature-zone">
    <div class="feature-title">{{featureTitle}}</div>
    <div class="feature-sub">{{featureSubtitle}}</div>
  </div>

  <!-- ═══════════════════════════════════════════════════ BODY (2 cols) -->
  <div class="columns">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr valign="top">

        <!-- ─────────────── LEFT COLUMN -->
        <td width="44%" style="padding-right:10px;">

          <!-- Card: Visão Geral -->
          <div class="card">
            <div class="card-title">Visão Geral</div>
            <div class="card-body">{{overviewText}}</div>
          </div>

          <!-- Card: Formatos Disponíveis -->
          <div class="card">
            <div class="card-title">Formatos Disponíveis</div>
            {{#each formats}}
            <table width="100%" cellpadding="0" cellspacing="4" style="margin-bottom:8px;">
              <tr valign="middle">
                <td width="36"><span class="fmt-label">{{format.label}}</span></td>
                <td><span class="fmt-desc">{{format.description}}</span></td>
              </tr>
            </table>
            {{/each}}
          </div>

          <!-- Card: Painéis -->
          <div class="card">
            <div class="card-title">Painéis com Exportação</div>
            {{#each panels}}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:7px;">
              <tr>
                <td width="110"><span class="panel-name">{{panel.name}}</span></td>
                <td><span class="panel-count">{{panel.deviceCount}} dispositivos monitorados</span></td>
              </tr>
            </table>
            {{/each}}
          </div>

          <!-- Card: Como usar -->
          <div class="card-steps">
            <div class="card-title">Como Usar</div>
            {{#each steps}}
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:9px;">
              <tr valign="top">
                <td width="24"><span class="step-num">{{step.number}}</span></td>
                <td style="padding-left:8px;padding-top:1px;"><span class="step-text">{{step.text}}</span></td>
              </tr>
            </table>
            {{/each}}
          </div>

        </td>

        <!-- ─────────────── RIGHT COLUMN -->
        <td width="56%" style="padding-left:10px;">
          <div class="card-right">

            <div class="metric-label">{{highlightPanelLabel}}</div>
            <div class="metric-value">{{highlightMetric}}</div>

            <!-- Feature highlight box -->
            <div class="feat-box">
              <div class="feat-badge">NOVO</div>
              <div class="feat-title">Barra de Exportação</div>
              <div class="feat-sub">Acesse PDF, XLS e CSV no topo de cada coluna do painel</div>
              <span class="btn-export">PDF</span>
              <span class="btn-export">XLS</span>
              <span class="btn-export">CSV</span>
            </div>

            <!-- Highlights / metrics -->
            {{#each highlights}}
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td class="hl-label">{{highlight.label}}</td>
                <td class="hl-value">{{highlight.value}}</td>
              </tr>
              <tr>
                <td colspan="2" class="hl-desc">{{highlight.description}}</td>
              </tr>
            </table>
            <hr class="hl-divider">
            {{/each}}

          </div>
        </td>

      </tr>
    </table>
  </div>

  <!-- ═══════════════════════════════════════════════════ FOOTER -->
  <div class="footer">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="footer-left">MYIO Plataforma de Telemetria &nbsp;·&nbsp; {{version}} &nbsp;·&nbsp; {{period}}</td>
        <td class="footer-center">{{featureTitle}}</td>
        <td class="footer-right">myio.com.br &nbsp;|&nbsp; atendimento@myio.com.br</td>
      </tr>
    </table>
  </div>

</div>
</body>
</html>$HTML$,
    NULL  -- created_by (system seed)
  );

  RAISE NOTICE 'Template % inserted successfully', v_slug;
END;
$$;
