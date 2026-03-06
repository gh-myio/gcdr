-- =============================================================================
-- MIGRATION: Template Types table + look_and_feels.template_type
-- =============================================================================
-- Cria tabela template_types (catálogo de tipos de template com metadados
-- editáveis pelo frontend) e adiciona FK nullable em look_and_feels para
-- permitir um tema por customer por tipo de template.
--
-- Uso após criação:
--   template_type = NULL  → tema geral (app UI, fallback de email)
--   template_type = 'EMAIL_ALARM' → tema específico para emails de alarme
-- =============================================================================

-- 1. Tabela de tipos de template
CREATE TABLE IF NOT EXISTS template_types (
  type        VARCHAR(50)  PRIMARY KEY,
  label       VARCHAR(100) NOT NULL,
  description TEXT,
  icon        VARCHAR(50),
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  active      BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. Seed dos 6 tipos canônicos
INSERT INTO template_types (type, label, description, icon, sort_order) VALUES
  ('EMAIL_ALARM',   'Alerta de Alarme',     'Enviado quando um alarme é disparado por uma regra de monitoramento',   'bell-alert',    1),
  ('EMAIL_REPORT',  'Relatório Periódico',  'Enviado com resumo de consumo e indicadores do período configurado',     'chart-bar',     2),
  ('EMAIL_WELCOME', 'Boas-vindas',          'Enviado ao novo usuário com link de ativação e instruções iniciais',     'envelope-open', 3),
  ('RELEASE_NOTE',  'Novidade de Versão',   'Comunicado de nova funcionalidade ou versão da plataforma MYIO',         'sparkles',      4),
  ('NOTIFICATION',  'Notificação Geral',    'Mensagem avulsa de alerta, informação ou ação direcionada ao usuário',   'bell',          5),
  ('INSIGHT',       'Insight de Consumo',   'Análise automática de consumo com métricas e recomendações de economia', 'light-bulb',    6)
ON CONFLICT (type) DO NOTHING;

-- 3. Adiciona coluna template_type em look_and_feels
ALTER TABLE look_and_feels
  ADD COLUMN IF NOT EXISTS template_type VARCHAR(50)
  REFERENCES template_types(type) ON DELETE RESTRICT;

-- 4. Unique index: 1 tema por customer por tipo de template
--    (temas globais, template_type IS NULL, permitem múltiplos por customer
--     mas apenas 1 is_default = true — regra garantida pela app)
CREATE UNIQUE INDEX IF NOT EXISTS look_and_feels_customer_type_uidx
  ON look_and_feels (customer_id, template_type)
  WHERE template_type IS NOT NULL;

-- Verificar resultado
SELECT type, label, icon, sort_order, active FROM template_types ORDER BY sort_order;
SELECT COUNT(*) AS total_themes, COUNT(template_type) AS typed_themes FROM look_and_feels;
