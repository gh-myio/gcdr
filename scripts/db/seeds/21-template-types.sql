-- =============================================================================
-- SEED: TEMPLATE TYPES
-- =============================================================================
-- Catálogo de tipos de template com label, descrição e ícone editáveis.
-- Usado pelo frontend para listar os tipos e permitir personalização.
-- O campo `type` é a chave primária (enum canônico da aplicação).
-- =============================================================================

INSERT INTO template_types (type, label, description, icon, sort_order, active) VALUES
  ('EMAIL_ALARM',
   'Alerta de Alarme',
   'Enviado quando um alarme é disparado por uma regra de monitoramento. Contém resumo dos dispositivos afetados, condição violada e destinatários configurados na regra.',
   'bell-alert',
   1,
   true),

  ('EMAIL_REPORT',
   'Relatório Periódico',
   'Enviado com resumo de consumo e indicadores do período configurado (diário, semanal ou mensal). Inclui métricas de energia, água e custo estimado.',
   'chart-bar',
   2,
   true),

  ('EMAIL_WELCOME',
   'Boas-vindas',
   'Enviado ao novo usuário com link de ativação e instruções iniciais para acesso à plataforma MYIO.',
   'envelope-open',
   3,
   true),

  ('RELEASE_NOTE',
   'Novidade de Versão',
   'Comunicado de nova funcionalidade ou versão da plataforma MYIO. Inclui destaque da feature, métricas e passos para utilização.',
   'sparkles',
   4,
   true),

  ('NOTIFICATION',
   'Notificação Geral',
   'Mensagem avulsa de alerta, informação ou ação direcionada ao usuário. Suporta níveis INFO, WARNING, ERROR e SUCCESS.',
   'bell',
   5,
   true),

  ('INSIGHT',
   'Insight de Consumo',
   'Análise automática de consumo com métricas do período e recomendações de economia geradas pela plataforma.',
   'light-bulb',
   6,
   true)

ON CONFLICT (type) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  sort_order  = EXCLUDED.sort_order,
  active      = EXCLUDED.active,
  updated_at  = NOW();

-- Verificar
SELECT type, label, icon, sort_order, active FROM template_types ORDER BY sort_order;
