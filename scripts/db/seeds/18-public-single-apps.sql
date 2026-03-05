-- =============================================================================
-- SEED: PUBLIC SINGLE APPS (RFC-0020)
-- =============================================================================
-- Sample data for public_single_apps and public_single_app_responses tables.
--
-- Apps:
--   psa-0001  myio-migration-form-v6   ACTIVE   (MYIO Migration Requirements Form)
--   psa-0002  myio-onboarding-checklist ACTIVE   (Onboarding Checklist)
--   psa-0003  myio-nda-form             DRAFT    (NDA / Confidentiality Form)
--
-- Responses (psa-0001 — migration form):
--   group-001  Helexia Brasil      v2 (revised) → APPROVED
--   group-002  Empresa XYZ         v1           → UNDER_REVIEW
--   group-003  ABC Energia         v3 (2 revisions) → SUBMITTED
--
-- Responses (psa-0002 — onboarding checklist):
--   group-004  Montserrat Energia  v1 → SUBMITTED
-- =============================================================================

DO $$
DECLARE
    v_admin_id  UUID := 'bbbb1111-1111-1111-1111-111111111111';

    -- App IDs
    v_app_migration   UUID := 'psa00001-0000-0000-0000-000000000001';
    v_app_onboarding  UUID := 'psa00001-0000-0000-0000-000000000002';
    v_app_nda         UUID := 'psa00001-0000-0000-0000-000000000003';

    -- Response group IDs
    v_group_helexia   UUID := 'psag0001-0000-0000-0000-000000000001';
    v_group_xyz       UUID := 'psag0001-0000-0000-0000-000000000002';
    v_group_abc       UUID := 'psag0001-0000-0000-0000-000000000003';
    v_group_mont      UUID := 'psag0001-0000-0000-0000-000000000004';

BEGIN

-- =============================================================================
-- APPS
-- =============================================================================

INSERT INTO public_single_apps
    (id, slug, name, description, fields_schema, status, metadata, created_at, updated_at, created_by, version)
VALUES
-- App 1: MYIO Migration Requirements Form (caso de uso principal)
(
    v_app_migration,
    'myio-migration-form-v6',
    'MYIO Migration Requirements Form v6',
    'Formulário de levantamento de requisitos técnicos para migração de dados históricos de IoT para a plataforma MYIO.',
    '{
        "sections": [
            { "key": "identification", "label": "1. Identificação do Cliente" },
            { "key": "domains",        "label": "2. Domínios de Medição", "type": "tabbed" },
            { "key": "volume",         "label": "3. Volume de Dados" },
            { "key": "delivery",       "label": "4. Entrega dos Dados" },
            { "key": "quality",        "label": "5. Qualidade dos Dados" },
            { "key": "schema",         "label": "6. Schema dos Dados" },
            { "key": "integration",    "label": "7. Integração" },
            { "key": "nfr",            "label": "8. Requisitos Não Funcionais" },
            { "key": "risks",          "label": "9. Riscos e Restrições" },
            { "key": "acceptance",     "label": "10. Critérios de Aceitação" },
            { "key": "timeline",       "label": "11. Cronograma" }
        ]
    }',
    'ACTIVE',
    '{ "owner": "time-migracao", "version": "v6", "formFile": "MYIO_Migration_Requirements_Form_v6.html" }',
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '10 days',
    v_admin_id,
    1
),
-- App 2: Onboarding Checklist
(
    v_app_onboarding,
    'myio-onboarding-checklist',
    'MYIO Onboarding Checklist',
    'Checklist de onboarding para novos clientes da plataforma MYIO. Cobre configuração inicial, treinamento e validação.',
    '{
        "sections": [
            { "key": "company",    "label": "1. Dados da Empresa" },
            { "key": "contacts",   "label": "2. Contatos Chave" },
            { "key": "infra",      "label": "3. Infraestrutura" },
            { "key": "training",   "label": "4. Treinamento" },
            { "key": "acceptance", "label": "5. Aceite" }
        ]
    }',
    'ACTIVE',
    '{ "owner": "time-onboarding" }',
    NOW() - INTERVAL '20 days',
    NOW() - INTERVAL '20 days',
    v_admin_id,
    1
),
-- App 3: NDA Form (em rascunho ainda)
(
    v_app_nda,
    'myio-nda-form',
    'MYIO Non-Disclosure Agreement',
    'Formulário de aceite de NDA para projetos de integração confidenciais.',
    '{}',
    'DRAFT',
    '{ "owner": "juridico" }',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '2 days',
    v_admin_id,
    1
);

-- =============================================================================
-- RESPONSES — App 1: myio-migration-form-v6
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 001: Helexia Brasil — v1 (original) + v2 (revisado) → APPROVED
-- ─────────────────────────────────────────────────────────────────────────────

-- v1 — versão original (is_latest = false)
INSERT INTO public_single_app_responses
    (id, app_id, response_group_id, response_version, is_latest,
     form_data, submitted_by, changes_from_previous, change_notes,
     status, metadata, created_at, updated_at, created_by)
VALUES (
    'psar0001-0001-0001-0001-000000000001',
    v_app_migration,
    v_group_helexia,
    1,
    false,
    '{
        "identification": {
            "empresa":             "Helexia Brasil",
            "cnpj":                "12.345.678/0001-90",
            "responsavel_tecnico": "João Silva",
            "email":               "joao.silva@helexia.com",
            "telefone":            "(11) 99999-9999",
            "responsavel_negocio": "Maria Santos"
        },
        "domains": {
            "energia": {
                "todasfases":       "trifasico",
                "grandezas":        ["kwh", "potencia", "tensao", "corrente"],
                "unidade_consumo":  "kwh",
                "precisao_decimal": "2",
                "demanda_contratada": "sim"
            },
            "agua": {
                "tipo":             ["volume_acumulado"],
                "unidade":          "m3",
                "precisao_decimal": "6",
                "multicanal":       "sim"
            }
        },
        "volume": {
            "data_inicial":  "2022-01-01",
            "data_final":    "2025-01-01",
            "periodo_total": "3 anos",
            "gaps":          "nao",
            "tamanho_banco": "50 GB"
        },
        "delivery": {
            "metodo":       "csv",
            "csv_formato":  "csv",
            "csv_encoding": "utf8",
            "csv_delim":    ";"
        },
        "quality": {
            "valores_nulos":  "sim",
            "timestamps_utc": "nao",
            "timezone":       "America/Sao_Paulo",
            "duplicatas":     "sim"
        }
    }',
    '{ "firstName": "João", "lastName": "Silva", "email": "joao.silva@helexia.com", "company": "Helexia Brasil" }',
    NULL,
    NULL,
    'APPROVED',
    '{}',
    NOW() - INTERVAL '8 days',
    NOW() - INTERVAL '6 days',
    NULL
);

-- v2 — revisão com alterações (is_latest = true)
INSERT INTO public_single_app_responses
    (id, app_id, response_group_id, response_version, is_latest,
     form_data, submitted_by, changes_from_previous, change_notes,
     status, metadata, created_at, updated_at, created_by)
VALUES (
    'psar0001-0001-0001-0001-000000000002',
    v_app_migration,
    v_group_helexia,
    2,
    true,
    '{
        "identification": {
            "empresa":             "Helexia Brasil",
            "cnpj":                "12.345.678/0001-90",
            "responsavel_tecnico": "João Silva",
            "email":               "joao.silva@helexia.com",
            "telefone":            "(11) 98888-0000",
            "responsavel_negocio": "Maria Santos"
        },
        "domains": {
            "energia": {
                "todasfases":       "trifasico",
                "grandezas":        ["kwh", "potencia", "tensao", "corrente"],
                "unidade_consumo":  "kwh",
                "precisao_decimal": "2",
                "demanda_contratada": "sim"
            },
            "agua": {
                "tipo":             ["volume_acumulado"],
                "unidade":          "m3",
                "precisao_decimal": "6",
                "multicanal":       "sim"
            }
        },
        "volume": {
            "data_inicial":  "2022-01-01",
            "data_final":    "2025-01-01",
            "periodo_total": "3 anos",
            "gaps":          "nao",
            "tamanho_banco": "65 GB"
        },
        "delivery": {
            "metodo":      "dump",
            "dump_banco":  "postgresql",
            "dump_versao": "15",
            "dump_tamanho": "65 GB"
        },
        "quality": {
            "valores_nulos":  "sim",
            "timestamps_utc": "nao",
            "timezone":       "America/Sao_Paulo",
            "duplicatas":     "sim"
        }
    }',
    '{ "firstName": "João", "lastName": "Silva", "email": "joao.silva@helexia.com", "company": "Helexia Brasil" }',
    '{
        "identification.telefone":  { "from": "(11) 99999-9999", "to": "(11) 98888-0000" },
        "volume.tamanho_banco":     { "from": "50 GB",           "to": "65 GB" },
        "delivery.metodo":          { "from": "csv",             "to": "dump" },
        "delivery.csv_formato":     { "from": "csv",             "to": null },
        "delivery.csv_encoding":    { "from": "utf8",            "to": null },
        "delivery.csv_delim":       { "from": ";",               "to": null },
        "delivery.dump_banco":      { "from": null,              "to": "postgresql" },
        "delivery.dump_versao":     { "from": null,              "to": "15" },
        "delivery.dump_tamanho":    { "from": null,              "to": "65 GB" }
    }',
    'Corrigido telefone. Alterado método de entrega de CSV para dump PostgreSQL após reunião com DBA. Tamanho do banco revisado para 65 GB.',
    'APPROVED',
    '{}',
    NOW() - INTERVAL '6 days',
    NOW() - INTERVAL '4 days',
    NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 002: Empresa XYZ — v1 → UNDER_REVIEW
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public_single_app_responses
    (id, app_id, response_group_id, response_version, is_latest,
     form_data, submitted_by, changes_from_previous, change_notes,
     status, metadata, created_at, updated_at, created_by)
VALUES (
    'psar0001-0002-0002-0002-000000000001',
    v_app_migration,
    v_group_xyz,
    1,
    true,
    '{
        "identification": {
            "empresa":             "Empresa XYZ Ltda",
            "cnpj":                "98.765.432/0001-11",
            "responsavel_tecnico": "Ana Oliveira",
            "email":               "ana.oliveira@empresaxyz.com",
            "telefone":            "(21) 97777-5555",
            "responsavel_negocio": "Carlos Mendes"
        },
        "domains": {
            "temperatura": {
                "grandezas":        ["temp_celsius"],
                "unidade":          "celsius",
                "precisao_decimal": "1"
            },
            "gases": {
                "tipo":             ["co2", "o2"],
                "unidade":          "ppm",
                "precisao_decimal": "3"
            }
        },
        "volume": {
            "data_inicial":  "2021-06-01",
            "data_final":    "2025-01-01",
            "periodo_total": "3 anos e meio",
            "gaps":          "sim",
            "tamanho_banco": "12 GB"
        },
        "delivery": {
            "metodo":       "csv",
            "csv_formato":  "csv",
            "csv_encoding": "utf8",
            "csv_delim":    ","
        },
        "quality": {
            "valores_nulos":  "sim",
            "timestamps_utc": "sim",
            "timezone":       "UTC",
            "duplicatas":     "nao"
        }
    }',
    '{ "firstName": "Ana", "lastName": "Oliveira", "email": "ana.oliveira@empresaxyz.com", "company": "Empresa XYZ Ltda" }',
    NULL,
    NULL,
    'UNDER_REVIEW',
    '{}',
    NOW() - INTERVAL '3 days',
    NOW() - INTERVAL '2 days',
    NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP 003: ABC Energia — v1 + v2 + v3 (3 versões) → SUBMITTED
-- ─────────────────────────────────────────────────────────────────────────────

-- v1
INSERT INTO public_single_app_responses
    (id, app_id, response_group_id, response_version, is_latest,
     form_data, submitted_by, changes_from_previous, change_notes,
     status, metadata, created_at, updated_at, created_by)
VALUES (
    'psar0001-0003-0003-0003-000000000001',
    v_app_migration,
    v_group_abc,
    1,
    false,
    '{
        "identification": {
            "empresa":             "ABC Energia S.A.",
            "cnpj":                "11.222.333/0001-44",
            "responsavel_tecnico": "Pedro Ferreira",
            "email":               "pedro@abcenergia.com",
            "telefone":            "(31) 96666-4444"
        },
        "domains": {
            "energia": {
                "todasfases":       "monofasico",
                "grandezas":        ["kwh"],
                "unidade_consumo":  "kwh",
                "precisao_decimal": "3"
            }
        },
        "volume": {
            "data_inicial":  "2020-01-01",
            "data_final":    "2025-01-01",
            "tamanho_banco": "5 GB"
        },
        "delivery": {
            "metodo": "api"
        }
    }',
    '{ "firstName": "Pedro", "lastName": "Ferreira", "email": "pedro@abcenergia.com", "company": "ABC Energia S.A." }',
    NULL,
    NULL,
    'SUBMITTED',
    '{}',
    NOW() - INTERVAL '5 days',
    NOW() - INTERVAL '5 days',
    NULL
);

-- v2
INSERT INTO public_single_app_responses
    (id, app_id, response_group_id, response_version, is_latest,
     form_data, submitted_by, changes_from_previous, change_notes,
     status, metadata, created_at, updated_at, created_by)
VALUES (
    'psar0001-0003-0003-0003-000000000002',
    v_app_migration,
    v_group_abc,
    2,
    false,
    '{
        "identification": {
            "empresa":             "ABC Energia S.A.",
            "cnpj":                "11.222.333/0001-44",
            "responsavel_tecnico": "Pedro Ferreira",
            "email":               "pedro@abcenergia.com",
            "telefone":            "(31) 96666-4444"
        },
        "domains": {
            "energia": {
                "todasfases":       "trifasico",
                "grandezas":        ["kwh", "potencia"],
                "unidade_consumo":  "kwh",
                "precisao_decimal": "3"
            }
        },
        "volume": {
            "data_inicial":  "2020-01-01",
            "data_final":    "2025-01-01",
            "tamanho_banco": "8 GB"
        },
        "delivery": {
            "metodo": "api"
        }
    }',
    '{ "firstName": "Pedro", "lastName": "Ferreira", "email": "pedro@abcenergia.com", "company": "ABC Energia S.A." }',
    '{
        "domains.energia.todasfases":  { "from": "monofasico", "to": "trifasico" },
        "domains.energia.grandezas":   { "from": ["kwh"],       "to": ["kwh", "potencia"] },
        "volume.tamanho_banco":        { "from": "5 GB",         "to": "8 GB" }
    }',
    'Corrigido: instalação é trifásica. Adicionado grandeza potência. Banco maior após auditoria.',
    'SUBMITTED',
    '{}',
    NOW() - INTERVAL '4 days',
    NOW() - INTERVAL '4 days',
    NULL
);

-- v3 (is_latest)
INSERT INTO public_single_app_responses
    (id, app_id, response_group_id, response_version, is_latest,
     form_data, submitted_by, changes_from_previous, change_notes,
     status, metadata, created_at, updated_at, created_by)
VALUES (
    'psar0001-0003-0003-0003-000000000003',
    v_app_migration,
    v_group_abc,
    3,
    true,
    '{
        "identification": {
            "empresa":             "ABC Energia S.A.",
            "cnpj":                "11.222.333/0001-44",
            "responsavel_tecnico": "Pedro Ferreira",
            "email":               "pedro@abcenergia.com",
            "telefone":            "(31) 96666-4444",
            "responsavel_negocio": "Roberta Lima"
        },
        "domains": {
            "energia": {
                "todasfases":       "trifasico",
                "grandezas":        ["kwh", "potencia"],
                "unidade_consumo":  "kwh",
                "precisao_decimal": "3"
            }
        },
        "volume": {
            "data_inicial":  "2020-01-01",
            "data_final":    "2025-01-01",
            "tamanho_banco": "8 GB"
        },
        "delivery": {
            "metodo":       "csv",
            "csv_formato":  "csv",
            "csv_encoding": "utf8",
            "csv_delim":    ";"
        }
    }',
    '{ "firstName": "Pedro", "lastName": "Ferreira", "email": "pedro@abcenergia.com", "company": "ABC Energia S.A." }',
    '{
        "identification.responsavel_negocio": { "from": null,  "to": "Roberta Lima" },
        "delivery.metodo":                    { "from": "api", "to": "csv" },
        "delivery.csv_formato":               { "from": null,  "to": "csv" },
        "delivery.csv_encoding":              { "from": null,  "to": "utf8" },
        "delivery.csv_delim":                 { "from": null,  "to": ";" }
    }',
    'Adicionado responsável de negócio. Alterado método de entrega para CSV (API não disponível no prazo).',
    'SUBMITTED',
    '{}',
    NOW() - INTERVAL '2 days',
    NOW() - INTERVAL '2 days',
    NULL
);

-- =============================================================================
-- RESPONSES — App 2: myio-onboarding-checklist
-- =============================================================================

-- GROUP 004: Montserrat Energia — v1 → SUBMITTED
INSERT INTO public_single_app_responses
    (id, app_id, response_group_id, response_version, is_latest,
     form_data, submitted_by, changes_from_previous, change_notes,
     status, metadata, created_at, updated_at, created_by)
VALUES (
    'psar0002-0004-0004-0004-000000000001',
    v_app_onboarding,
    v_group_mont,
    1,
    true,
    '{
        "company": {
            "nome":   "Montserrat Energia",
            "cnpj":   "55.444.333/0001-22",
            "setor":  "Energia Renovável",
            "porte":  "médio"
        },
        "contacts": {
            "tecnico": { "nome": "Lucas Monteiro", "email": "lucas@montserrat.com.br", "telefone": "(11) 95555-3333" },
            "negocio": { "nome": "Fernanda Rocha",  "email": "fernanda@montserrat.com.br" }
        },
        "infra": {
            "num_sites":    3,
            "num_devices":  45,
            "conectividade": "4G + WiFi",
            "sistema_atual": "SCADA próprio"
        },
        "training": {
            "modalidade": "presencial",
            "num_usuarios": 8,
            "data_prevista": "2026-04-15"
        },
        "acceptance": {
            "aceita_termos": true,
            "data_assinatura": "2026-03-04"
        }
    }',
    '{ "firstName": "Lucas", "lastName": "Monteiro", "email": "lucas@montserrat.com.br", "company": "Montserrat Energia" }',
    NULL,
    NULL,
    'SUBMITTED',
    '{}',
    NOW() - INTERVAL '1 day',
    NOW() - INTERVAL '1 day',
    NULL
);

RAISE NOTICE 'Inserted 3 public apps';
RAISE NOTICE 'Inserted 7 response records across 4 response groups';
RAISE NOTICE '  group-001 (Helexia):    v2 → APPROVED';
RAISE NOTICE '  group-002 (XYZ):        v1 → UNDER_REVIEW';
RAISE NOTICE '  group-003 (ABC):        v3 → SUBMITTED';
RAISE NOTICE '  group-004 (Montserrat): v1 → SUBMITTED';

END $$;

-- =============================================================================
-- VERIFY
-- =============================================================================

SELECT id, slug, status, version, created_at
FROM public_single_apps
ORDER BY created_at;

SELECT
    r.response_group_id,
    r.response_version,
    r.is_latest,
    r.status,
    r.submitted_by->>'company'   AS company,
    r.submitted_by->>'email'     AS email,
    CASE WHEN r.changes_from_previous IS NULL THEN '—' ELSE array_to_string(ARRAY(SELECT jsonb_object_keys(r.changes_from_previous)), ', ') END AS changed_fields,
    a.slug                        AS app_slug
FROM public_single_app_responses r
JOIN public_single_apps a ON a.id = r.app_id
ORDER BY a.slug, r.response_group_id, r.response_version;
