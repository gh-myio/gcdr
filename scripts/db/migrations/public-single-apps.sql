-- =============================================================================
-- Migration: Public Single Apps
-- =============================================================================
-- Tables for storing single-page applications (HTML forms) and their
-- versioned form responses (submissions).
--
-- Design:
--   public_single_apps            — app/form definitions (one per page type)
--   public_single_app_responses   — versioned submissions (N per app)
--
-- Versioning model:
--   Each "fill" of a form is a response_group (UUID).
--   Revisions within that fill increment response_version (1, 2, 3...).
--   is_latest = true marks the current revision for fast lookups.
-- =============================================================================

-- =============================================================================
-- TABLE 1: public_single_apps
-- Defines the page/form (slug, name, description, optional field schema)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public_single_apps (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  slug        VARCHAR(100) NOT NULL UNIQUE,   -- e.g. "myio-migration-form-v6"
  name        VARCHAR(255) NOT NULL,          -- "MYIO Migration Requirements Form"
  description TEXT,

  -- Optional: JSON definition of the form fields/sections
  -- Useful for rendering or validating submissions server-side
  fields_schema JSONB NOT NULL DEFAULT '{}',

  -- Status
  status      VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | INACTIVE | DRAFT | ARCHIVED

  metadata    JSONB        NOT NULL DEFAULT '{}',

  -- Audit
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by  UUID,
  version     INTEGER      NOT NULL DEFAULT 1,

  CONSTRAINT public_single_apps_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'DRAFT', 'ARCHIVED'))
);

CREATE INDEX idx_psa_slug   ON public_single_apps (slug);
CREATE INDEX idx_psa_status ON public_single_apps (status);

COMMENT ON TABLE  public_single_apps              IS 'Single-page application / form definitions';
COMMENT ON COLUMN public_single_apps.slug         IS 'URL-safe identifier, unique per form type';
COMMENT ON COLUMN public_single_apps.fields_schema IS 'Optional JSON schema of fields/sections for rendering or validation';


-- =============================================================================
-- TABLE 2: public_single_app_responses
-- Stores versioned form submissions.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public_single_app_responses (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                UUID        NOT NULL REFERENCES public_single_apps(id),

  -- Groups all versions of the same "fill" together
  response_group_id     UUID        NOT NULL DEFAULT gen_random_uuid(),

  -- Revision number within the group (1 = first, 2 = revised, etc.)
  response_version      INTEGER     NOT NULL DEFAULT 1,

  -- Denormalised flag: true only on the latest version of each group
  -- Maintained by application logic on every upsert
  is_latest             BOOLEAN     NOT NULL DEFAULT TRUE,

  -- ────────────────────────────────────────────────────────────────
  -- Core payload
  -- ────────────────────────────────────────────────────────────────

  -- All field values from the form, nested by section key
  -- Example structure for MYIO Migration Form:
  -- {
  --   "identification": {
  --     "empresa": "Helexia Brasil",
  --     "cnpj": "12.345.678/0001-90",
  --     "responsavel_tecnico": "João Silva",
  --     "email": "joao@helexia.com",
  --     "telefone": "(11) 99999-9999",
  --     "responsavel_negocio": "Maria Santos"
  --   },
  --   "domains": {
  --     "energia": {
  --       "todasfases": "trifasico",
  --       "grandezas": ["kwh", "potencia", "tensao"],
  --       "unidade_consumo": "kwh",
  --       "precisao_decimal": "2"
  --     },
  --     "agua": { ... },
  --     "temperatura": { ... }
  --   },
  --   "volume": {
  --     "data_inicial": "2022-01-01",
  --     "data_final": "2025-01-01",
  --     "periodo_total": "3 anos",
  --     "gaps": "nao"
  --   },
  --   "delivery": { "metodo": "csv", "csv_formato": "csv", ... },
  --   "quality": { "valores_nulos": "sim", "timestamps_utc": "nao", ... },
  --   "schema": { "energia": [{ "campo": "...", "tipo": "...", "exemplo": "..." }] },
  --   "integration": { "metodo": "batch", "batch_formato": "csv", ... },
  --   "nfr": { "sensivel": "nao", "cripto_transito": "sim", ... },
  --   "risks": { "lista": "...", "restricoes": "..." },
  --   "acceptance": { "rollback": "sim", "backup_obrigatorio": "sim" },
  --   "timeline": { "observacoes": "..." }
  -- }
  form_data             JSONB       NOT NULL DEFAULT '{}',

  -- ────────────────────────────────────────────────────────────────
  -- Submitter info (external user — not necessarily in users table)
  -- ────────────────────────────────────────────────────────────────
  -- {
  --   "firstName": "João",
  --   "lastName":  "Silva",
  --   "email":     "joao@helexia.com",
  --   "company":   "Helexia Brasil"
  -- }
  submitted_by          JSONB       NOT NULL DEFAULT '{}',

  -- ────────────────────────────────────────────────────────────────
  -- Versioning / changelog
  -- ────────────────────────────────────────────────────────────────

  -- JSON diff: what changed from the previous version
  -- { "fieldKey": { "from": "old_value", "to": "new_value" }, ... }
  -- null on version 1 (no previous)
  changes_from_previous JSONB,

  -- Human-readable notes about what was revised
  change_notes          TEXT,

  -- Status of this response
  status                VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  -- DRAFT | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED

  metadata              JSONB        NOT NULL DEFAULT '{}',

  -- Audit
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by            UUID,

  -- Constraints
  CONSTRAINT psar_version_unique   UNIQUE (response_group_id, response_version),
  CONSTRAINT psar_version_positive CHECK  (response_version >= 1),
  CONSTRAINT psar_status_check     CHECK  (status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'))
);

-- One and only one "latest" per group
CREATE UNIQUE INDEX idx_psar_latest_per_group
  ON public_single_app_responses (response_group_id)
  WHERE is_latest = TRUE;

CREATE INDEX idx_psar_app_id          ON public_single_app_responses (app_id);
CREATE INDEX idx_psar_group           ON public_single_app_responses (response_group_id);
CREATE INDEX idx_psar_status          ON public_single_app_responses (status);
CREATE INDEX idx_psar_submitted_email ON public_single_app_responses ((submitted_by->>'email'));
CREATE INDEX idx_psar_created_at      ON public_single_app_responses (created_at DESC);

COMMENT ON TABLE  public_single_app_responses                      IS 'Versioned form submissions for single-page apps';
COMMENT ON COLUMN public_single_app_responses.response_group_id    IS 'Groups all revisions of the same form fill together';
COMMENT ON COLUMN public_single_app_responses.response_version     IS '1 = first submission, 2+ = revisions';
COMMENT ON COLUMN public_single_app_responses.is_latest            IS 'True only on the most recent revision of each group';
COMMENT ON COLUMN public_single_app_responses.form_data            IS 'All field values nested by section key';
COMMENT ON COLUMN public_single_app_responses.submitted_by         IS 'Submitter: { firstName, lastName, email, company }';
COMMENT ON COLUMN public_single_app_responses.changes_from_previous IS 'Diff from prior version: { fieldKey: { from, to } }';
