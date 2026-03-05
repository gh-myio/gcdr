-- =============================================================================
-- Migration: HTML Templates Engine (RFC-0021)
-- =============================================================================
-- Table for storing HTML email/notification templates with versioning.
-- Templates use a Handlebars-like syntax ({{variable}}, {{#each list}}).
--
-- Types:
--   EMAIL_ALARM    — triggered alarm notification
--   EMAIL_REPORT   — periodic reports
--   EMAIL_WELCOME  — onboarding / welcome
--
-- Status lifecycle:
--   DRAFT → ACTIVE (only one ACTIVE per tenant+type)
--   ACTIVE → ARCHIVED (soft delete)
-- =============================================================================

CREATE TABLE IF NOT EXISTS templates (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          VARCHAR(255)  NOT NULL,
  tenant_id     UUID          NOT NULL,

  -- Identity
  name          VARCHAR(500)  NOT NULL,
  type          VARCHAR(50)   NOT NULL,   -- EMAIL_ALARM | EMAIL_REPORT | EMAIL_WELCOME
  status        VARCHAR(50)   NOT NULL DEFAULT 'DRAFT',

  -- Content — TEXT (not jsonb, not varchar) — supports 20–50 KB HTML
  html_content  TEXT          NOT NULL,

  description   VARCHAR(1000),

  -- Versioning (incremented on every PUT)
  version       INTEGER       NOT NULL DEFAULT 1,

  -- Audit
  created_by    UUID,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT templates_slug_tenant_unique UNIQUE (slug, tenant_id),
  CONSTRAINT templates_type_check   CHECK (type   IN ('EMAIL_ALARM', 'EMAIL_REPORT', 'EMAIL_WELCOME')),
  CONSTRAINT templates_status_check CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
);

-- Fast lookup: tenant + type + status (used when selecting ACTIVE template to send email)
CREATE INDEX IF NOT EXISTS idx_templates_tenant_type_status ON templates (tenant_id, type, status);
-- Slug lookup per tenant
CREATE INDEX IF NOT EXISTS idx_templates_slug ON templates (tenant_id, slug);

COMMENT ON TABLE  templates               IS 'HTML email/notification templates — RFC-0021';
COMMENT ON COLUMN templates.slug          IS 'URL-safe identifier, unique per tenant';
COMMENT ON COLUMN templates.html_content  IS 'Raw HTML with {{tag}} placeholders — stored as TEXT';
COMMENT ON COLUMN templates.version       IS 'Auto-incremented on each PUT update';
