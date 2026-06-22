# RFC-0020: Public Single Apps — Formulários HTML com Respostas Versionadas

- **Feature Name:** `public-single-apps`
- **Start Date:** 2026-03-04
- **RFC PR:** (preencher quando o PR for criado)
- **Tracking Issue:** (preencher quando a issue for criada)
- **Status:** Draft
- **Authors:** MYIO Platform Team
- **Related RFCs:** —
- **Stakeholders:** Backend, Produto, Comercial / Onboarding

---

## Summary

Este RFC introduz o módulo **Public Single Apps** no GCDR: um mecanismo genérico para hospedar formulários HTML de página única (*single-page apps*), coletar as respostas dos usuários e armazená-las de forma **versionada**.

O primeiro caso de uso concreto é o **"MYIO Migration Requirements Form"** — formulário de levantamento de requisitos de migração de dados entregue a clientes (ex.: Helexia) via link público. Quando um cliente preenche e revisa o formulário, cada versão da resposta é preservada, com rastreabilidade de quem alterou o quê.

O módulo é composto por:

1. **Duas tabelas** no banco: `public_single_apps` (definição do app) e `public_single_app_responses` (respostas versionadas).
2. **API REST** para criar apps, submeter respostas e navegar pelo histórico de versões.
3. Suporte a **diff automático** entre versões (`changes_from_previous`).

---

## Motivation

### Problema

O time comercial e de onboarding da MYIO entrega formulários HTML de levantamento (migração, requisitos técnicos, assessment) a clientes externos. Atualmente o fluxo é:

1. O formulário é enviado por e-mail como arquivo `.html`.
2. O cliente preenche localmente, exporta como PDF e devolve por e-mail.
3. O time MYIO transcreve os dados manualmente para planilhas ou documentos.

Não há **rastreabilidade de revisões**: quando o cliente altera o formulário e reenvia, é impossível saber o que mudou. Não há **histórico estruturado** dos dados coletados, o que dificulta auditorias, comparações e integrações com outros sistemas.

### Use Cases

1. **Migration Assessment (Helexia):** O time de migração envia o link do formulário para o responsável técnico da Helexia. Ele preenche com os detalhes do sistema de origem (schemas, volumes, domínios de medição). Após revisão interna, o cliente atualiza três campos — o GCDR grava uma nova versão com o diff automático das mudanças.

2. **Onboarding Checklist:** Qualquer formulário recorrente de onboarding de novos clientes pode ser cadastrado como um `public_single_app` e ter suas respostas centralizado no GCDR.

3. **Histórico para Auditoria:** O time de Sucesso do Cliente consulta todas as versões de uma resposta, com data, e-mail e empresa do respondente, para entender a evolução dos requisitos ao longo de um engajamento.

---

## Guide-level Explanation

### Conceitos

| Termo | Descrição |
|---|---|
| **App** | Um formulário/página cadastrado no sistema (`public_single_apps`). Identificado por um `slug` único. |
| **Resposta** | Uma submissão de formulário (`public_single_app_responses`). Contém todos os campos do form em JSONB. |
| **Grupo de Resposta** | `response_group_id` — UUID que agrupa todas as revisões de uma mesma submissão. |
| **Versão** | `response_version` — inteiro crescente (1, 2, 3…) dentro de um grupo. |
| **Última Versão** | `is_latest = true` — marcação denormalizada para lookup rápido. |

### Fluxo típico

```
1. Admin cadastra o app:
   POST /public-apps  { slug: "myio-migration-form-v6", name: "...", ... }

2. Cliente acessa o link público e preenche o formulário:
   POST /public-apps/myio-migration-form-v6/responses
   → Cria response_group_id e version = 1, is_latest = true

3. Cliente revisa e reenvia:
   POST /public-apps/myio-migration-form-v6/responses/{groupId}/revise
   → Cria version = 2, is_latest = true (version 1 passa para is_latest = false)
   → changes_from_previous é calculado automaticamente

4. Time MYIO consulta o histórico:
   GET /public-apps/myio-migration-form-v6/responses/{groupId}/history
   → Retorna todas as versões com diffs
```

### Exemplo de payload de submissão

```json
POST /public-apps/myio-migration-form-v6/responses

{
  "submittedBy": {
    "firstName": "João",
    "lastName":  "Silva",
    "email":     "joao@helexia.com",
    "company":   "Helexia Brasil"
  },
  "formData": {
    "identification": {
      "empresa":              "Helexia Brasil",
      "cnpj":                 "12.345.678/0001-90",
      "responsavel_tecnico":  "João Silva",
      "email":                "joao@helexia.com",
      "telefone":             "(11) 99999-9999",
      "responsavel_negocio":  "Maria Santos"
    },
    "domains": {
      "energia": {
        "todasfases":          "trifasico",
        "grandezas":           ["kwh", "potencia", "tensao", "corrente"],
        "unidade_consumo":     "kwh",
        "precisao_decimal":    "2",
        "demanda_contratada":  "sim"
      },
      "agua": {
        "tipo":                ["volume_acumulado"],
        "unidade":             "m3",
        "precisao_decimal":    "6",
        "multicanal":          "sim"
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
      "metodo":        "csv",
      "csv_formato":   "csv",
      "csv_encoding":  "utf8",
      "csv_delim":     ";",
      "csv_compressao":"gzip"
    },
    "quality": {
      "valores_nulos":    "sim",
      "timestamps_utc":   "nao",
      "timezone":         "America/Sao_Paulo",
      "duplicatas":       "sim",
      "regras_limpeza":   "Remover leituras NULL; converter BRT → UTC"
    }
  }
}
```

### Exemplo de revisão com diff automático

Quando o cliente reenvia com `delivery.metodo` alterado de `"csv"` para `"dump"`:

```json
POST /public-apps/myio-migration-form-v6/responses/{groupId}/revise

{
  "submittedBy": { ... mesmos dados ... },
  "changeNotes": "Alterado método de entrega: CSV → Dump do banco após reunião com DBA",
  "formData": {
    ...
    "delivery": { "metodo": "dump", "dump_banco": "postgresql", "dump_tamanho": "30 GB" },
    ...
  }
}
```

**Resposta:** versão 2 criada com:

```json
{
  "responseVersion": 2,
  "isLatest": true,
  "changeNotes": "Alterado método de entrega: CSV → Dump do banco após reunião com DBA",
  "changesFromPrevious": {
    "delivery.metodo":      { "from": "csv",  "to": "dump" },
    "delivery.csv_formato": { "from": "csv",  "to": null },
    "delivery.dump_banco":  { "from": null,   "to": "postgresql" },
    "delivery.dump_tamanho":{ "from": null,   "to": "30 GB" }
  }
}
```

---

## Reference-level Explanation

### 1. Database Schema

#### `public_single_apps`

```sql
CREATE TABLE public_single_apps (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          VARCHAR(100) NOT NULL UNIQUE,   -- URL-safe identifier
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  fields_schema JSONB        NOT NULL DEFAULT '{}',  -- optional field definitions
  status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  metadata      JSONB        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by    UUID,
  version       INTEGER      NOT NULL DEFAULT 1,
  CONSTRAINT psa_status_check CHECK (status IN ('ACTIVE','INACTIVE','DRAFT','ARCHIVED'))
);
```

#### `public_single_app_responses`

```sql
CREATE TABLE public_single_app_responses (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id                UUID        NOT NULL REFERENCES public_single_apps(id),
  response_group_id     UUID        NOT NULL DEFAULT gen_random_uuid(),
  response_version      INTEGER     NOT NULL DEFAULT 1,
  is_latest             BOOLEAN     NOT NULL DEFAULT TRUE,

  form_data             JSONB       NOT NULL DEFAULT '{}',
  submitted_by          JSONB       NOT NULL DEFAULT '{}',
  -- { "firstName", "lastName", "email", "company" }

  changes_from_previous JSONB,
  -- { "fieldKey": { "from": <old>, "to": <new> } } — null na versão 1

  change_notes          TEXT,
  status                VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  metadata              JSONB        NOT NULL DEFAULT '{}',

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by            UUID,

  CONSTRAINT psar_version_unique   UNIQUE (response_group_id, response_version),
  CONSTRAINT psar_version_positive CHECK  (response_version >= 1),
  CONSTRAINT psar_status_check     CHECK  (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED'))
);

-- Garante exatamente uma "latest" por grupo
CREATE UNIQUE INDEX idx_psar_latest_per_group
  ON public_single_app_responses (response_group_id)
  WHERE is_latest = TRUE;

CREATE INDEX idx_psar_app_id          ON public_single_app_responses (app_id);
CREATE INDEX idx_psar_group           ON public_single_app_responses (response_group_id);
CREATE INDEX idx_psar_status          ON public_single_app_responses (status);
CREATE INDEX idx_psar_submitted_email ON public_single_app_responses ((submitted_by->>'email'));
CREATE INDEX idx_psar_created_at      ON public_single_app_responses (created_at DESC);
```

**Invariante mantida pela aplicação:** quando uma nova revisão é criada para um `response_group_id`, a aplicação executa dentro de uma transaction:
1. `UPDATE ... SET is_latest = FALSE WHERE response_group_id = ? AND is_latest = TRUE`
2. `INSERT ... (is_latest = TRUE, response_version = prev + 1)`

---

### 2. Endpoints

#### Apps

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/public-apps` | Cadastra um novo app/formulário |
| `GET` | `/public-apps` | Lista todos os apps |
| `GET` | `/public-apps/:slug` | Retorna um app pelo slug |
| `PUT` | `/public-apps/:slug` | Atualiza metadados do app |
| `DELETE` | `/public-apps/:slug` | Arquiva o app (soft) |

#### Respostas

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/public-apps/:slug/responses` | Cria primeira versão de uma resposta |
| `POST` | `/public-apps/:slug/responses/:groupId/revise` | Cria nova revisão (versão N+1) |
| `GET` | `/public-apps/:slug/responses` | Lista últimas versões de todas as submissões |
| `GET` | `/public-apps/:slug/responses/:groupId` | Retorna a versão mais recente de uma resposta |
| `GET` | `/public-apps/:slug/responses/:groupId/history` | Retorna todas as versões de uma resposta |
| `GET` | `/public-apps/:slug/responses/:groupId/version/:v` | Retorna versão específica |

> **Auth:** Endpoints de leitura/escrita de respostas podem ser públicos (sem JWT) para permitir uso por clientes externos sem conta. Endpoints de gestão de apps (`POST /public-apps`, etc.) requerem autenticação JWT.

---

### 3. Diff automático (`changes_from_previous`)

O cálculo do diff é feito no `PublicSingleAppService.revise()` usando uma função utilitária `flatDiff(prev, next)` que:

1. Achata ambos os JSONs em paths com pontos: `"domains.energia.unidade" → "kwh"`
2. Compara chave a chave, registrando apenas os campos que mudaram
3. Inclui campos removidos (`to: null`) e adicionados (`from: null`)

**Exemplo:**

```typescript
flatDiff(
  { delivery: { metodo: "csv", csv_encoding: "utf8" } },
  { delivery: { metodo: "dump", dump_banco: "postgresql" } }
)
// →
{
  "delivery.metodo":       { from: "csv",  to: "dump" },
  "delivery.csv_encoding": { from: "utf8", to: null },
  "delivery.dump_banco":   { from: null,   to: "postgresql" }
}
```

---

### 4. Arquivos a criar/modificar

#### Novos arquivos

| Arquivo | Descrição |
|---|---|
| `scripts/db/migrations/public-single-apps.sql` | DDL das duas tabelas |
| `src/infrastructure/database/drizzle/schema.ts` | Definições Drizzle das tabelas |
| `src/domain/entities/PublicSingleApp.ts` | Entidade `PublicSingleApp` |
| `src/domain/entities/PublicSingleAppResponse.ts` | Entidade `PublicSingleAppResponse` |
| `src/dto/request/PublicSingleAppDTO.ts` | Zod schemas de request |
| `src/repositories/interfaces/IPublicSingleAppRepository.ts` | Interface do repositório |
| `src/repositories/PublicSingleAppRepository.ts` | Implementação Drizzle |
| `src/services/PublicSingleAppService.ts` | Lógica de negócio + diff |
| `src/shared/utils/flatDiff.ts` | Função utilitária de diff de JSONB |
| `src/controllers/public-single-apps.controller.ts` | Router Express |

#### Modificados

| Arquivo | Mudança |
|---|---|
| `src/infrastructure/database/drizzle/schema.ts` | Adicionar export das duas tabelas |
| `src/infrastructure/database/drizzle/db.ts` | Exportar tipos inferidos |
| `src/controllers/index.ts` | Registrar rota `/public-apps` |
| `src/shared/events/eventTypes.ts` | Adicionar eventos `PUBLIC_APP_*` |
| `src/shared/types/audit.types.ts` | Adicionar ao enum `EventType` |

---

### 5. `fields_schema` — Definição opcional dos campos

O campo `fields_schema` em `public_single_apps` pode armazenar a estrutura do formulário para uso por frontends dinâmicos:

```json
{
  "sections": [
    {
      "key": "identification",
      "label": "1. Identificação do Cliente",
      "fields": [
        { "key": "empresa",             "label": "Nome da Empresa",       "type": "text",  "required": true },
        { "key": "cnpj",               "label": "CNPJ",                   "type": "text",  "required": true },
        { "key": "responsavel_tecnico", "label": "Responsável Técnico",   "type": "text",  "required": true },
        { "key": "email",              "label": "E-mail",                  "type": "email", "required": true }
      ]
    },
    {
      "key": "domains",
      "label": "2. Domínios de Medição",
      "type": "tabbed",
      "tabs": ["energia", "agua", "temperatura", "acionamento", "gases", "nivel"]
    }
  ]
}
```

Este campo é **opcional e não validado** pelo backend na v1 — a responsabilidade de validar `form_data` contra `fields_schema` fica no cliente. O backend aceita qualquer JSON válido em `form_data`.

---

## Migration Strategy

### Fase 1 — Tabelas e API básica (esta RFC)

1. Rodar migration `public-single-apps.sql`
2. Adicionar tabelas ao schema Drizzle
3. Implementar controllers/service/repository
4. Cadastrar o `myio-migration-form-v6` como primeiro app via seed ou API

### Fase 2 — Integrações futuras

- Geração automática de PDF a partir da resposta (substituir o `html2pdf` client-side)
- Notificação por e-mail ao time MYIO quando uma nova resposta/revisão for submetida
- Webhook configurável por app

---

## Drawbacks

1. **`form_data` é schema-less:** o backend não valida os campos do formulário contra um schema. Uma resposta com campos errados ou incompletos é aceita. Mitigação: validação fica no frontend HTML existente; a v1 não exige validação server-side.

2. **Diff é superficial:** `flatDiff` compara paths string. Mudanças em arrays (ex.: `grandezas: ["kwh"] → ["kwh", "tensao"]`) são registradas como substituição do array inteiro, não como adição de elemento. Mitigação: para arrays de checkboxes isso é aceitável; pode ser refinado se necessário.

3. **`is_latest` denormalizado:** requer que a aplicação mantenha a invariante em uma transaction. Um bug pode deixar dois registros com `is_latest = true`. Mitigação: unique partial index (`WHERE is_latest = TRUE`) impede isso no banco.

---

## Alternatives Considered

### A. Usar Notion / Google Forms / Typeform

Ferramentas externas prontas para coleta de formulários.

**Rejeitado:** os dados precisam estar no ecossistema MYIO para integração com outros módulos (ex.: um futuro pipeline de migração que lê `form_data` e pré-popula estruturas no GCDR). Além disso, a identidade visual do formulário HTML customizado é importante para o comercial.

### B. Versionar com `updated_at` e sem histórico

Manter apenas a última versão da resposta, sem versionamento.

**Rejeitado:** o requisito explícito é rastrear revisões e saber o que mudou entre elas. Sem histórico, o diff é impossível.

### C. Tabela por formulário

Criar uma tabela específica para cada tipo de formulário (ex.: `migration_form_responses`).

**Rejeitado:** aumenta a proliferação de tabelas e dificulta a criação de novos formulários sem uma migration. O JSONB genérico permite adicionar novos tipos de formulário sem alteração de schema.

---

## Unresolved Questions

1. **Auth nas rotas públicas:** Os endpoints de submissão de resposta são públicos (sem JWT). É necessário algum mecanismo de rate-limiting ou token temporário por link para evitar spam?

2. **Notificação ao time MYIO:** Quando uma nova resposta for submetida, deve ser enviado um e-mail para um endereço configurado por app? Qual o mecanismo (SMTP próprio, webhook, integração com outro serviço)?

3. **`submitted_by` deve ser vinculado a um `user.id` do GCDR?** Clientes externos não têm conta no GCDR; para clientes internos (ex.: equipe MYIO testando o form), seria útil vincular. Deixar como campo opcional `userId` em `submitted_by`?

4. **Retenção de dados:** Respostas antigas de formulários de teste devem ser removidas automaticamente? Definir política de TTL por app?

---

## Future Possibilities

- **Renderização server-side do HTML:** em vez de o cliente hospedar o arquivo `.html`, o GCDR serve o formulário em `GET /public-apps/:slug/render` usando `fields_schema` como fonte de verdade.
- **Pipeline de migração automatizado:** um job lê `form_data` de uma resposta aprovada e pré-popula `customers`, `assets` e `devices` no GCDR, eliminando entrada manual.
- **Assinatura digital:** o respondente assina a resposta com um token único enviado por e-mail, gerando um `signature` armazenado em `metadata`.
- **Comparação entre clientes:** o time de produto compara `form_data` de múltiplos clientes para identificar padrões de requisitos e priorizar roadmap.
