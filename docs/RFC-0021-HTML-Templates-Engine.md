# RFC-0021: HTML Templates Engine + Hybrid Payload Standard

- **Feature Name:** `html-templates-engine`
- **Start Date:** 2026-03-01
- **RFC PR:** (preencher quando o PR for criado)
- **Tracking Issue:** (preencher quando a issue for criada)
- **Status:** Implemented
- **Authors:** MYIO Platform Team
- **Related RFCs:** RFC-0010 (Alarm Simulator), RFC-0015 (Alarm Bundle Version History)
- **Stakeholders:** Backend, Produto, Comercial, Customer Success

---

## Summary

Este RFC especifica o módulo **HTML Templates Engine** do GCDR: um mecanismo para armazenar, versionar e renderizar templates HTML parametrizados por tenant. Ao invés de embutir HTML hardcoded nos serviços de envio de e-mail, notificação e insights, todos os templates são gerenciados via API REST com suporte a variáveis `{{handlebars-like}}` e loops `{{#each}}` aninhados.

O RFC também define o **Hybrid Payload Standard** — o contrato de dados universal para renderização de templates, garantindo que qualquer consumidor (alarm-orchestrator, relatórios, welcome e-mail, etc.) envie payloads compatíveis com o mesmo engine.

---

## Motivation

### Problema

O ecossistema MYIO dispara múltiplos tipos de comunicação com usuários e clientes: e-mails de alarme, relatórios periódicos, e-mails de boas-vindas, release notes, notificações de sistema e insights de consumo. Antes deste módulo:

1. **HTML embutido no código:** qualquer ajuste visual exigia um deploy.
2. **Sem multi-tenant:** impossível ter templates diferentes por cliente (ex.: tema personalizado).
3. **Sem versionamento:** não havia histórico de qual template foi usado para gerar um e-mail específico.
4. **Payloads inconsistentes:** cada serviço definia seu próprio formato de dados para renderização, dificultando o compartilhamento de templates entre módulos.

### Solução

Um módulo dedicado no GCDR que:

- Armazena templates HTML no banco com `slug`, `type`, `status` e `version`.
- Expõe API CRUD + endpoints especializados (`preview`, `getActiveByType`, `tag-catalog`).
- Renderiza templates com um engine próprio (sem dependência externa): suporte a `{{variável}}` e `{{#each lista}}...{{/each}}` aninhado.
- Define um **Hybrid Payload Standard** — envelope JSON com campos compartilhados (`platform`, `customer`, `user`) e campos type-specific adicionados ao mesmo objeto.

---

## Guide-level Explanation

### Conceitos

| Termo | Descrição |
|---|---|
| **Template** | Documento HTML armazenado no banco, identificado por `slug` único por tenant. |
| **Type** | Categoria do template: `EMAIL_ALARM`, `EMAIL_REPORT`, `EMAIL_WELCOME`, `RELEASE_NOTE`, `NOTIFICATION`, `INSIGHT`. |
| **Status** | `DRAFT` → `ACTIVE` → `ARCHIVED`. Apenas `ACTIVE` é retornado pelo endpoint `getActiveByType`. |
| **Tag** | Placeholder `{{caminho.aninhado}}` dentro do HTML, substituído em runtime pelo engine. |
| **Tag Catalog** | Lista de tags disponíveis por tipo, exposta em `GET /templates/tag-catalog?type=X`. |
| **Hybrid Payload** | Envelope JSON com campos compartilhados + campos type-specific, passado ao renderizar. |

### Fluxo típico de uso

```
1. Admin cadastra template:
   POST /templates { slug: "alarm-pt-br", type: "EMAIL_ALARM", htmlContent: "...", status: "ACTIVE" }

2. Serviço externo busca o template ativo:
   GET /templates/active?type=EMAIL_ALARM
   → { id, slug, htmlContent, ... }

3. Serviço externo renderiza com dados do evento:
   POST /templates/alarm-pt-br/preview { data: { platform: {...}, customer: {...}, summary: {...}, rules: [...] } }
   → HTML renderizado pronto para envio

4. Editor consulta as tags disponíveis:
   GET /templates/tag-catalog?type=EMAIL_ALARM
   → [{ tag, label, description, example }, ...]
```

---

## Reference-level Explanation

### 1. Database Schema

```sql
CREATE TYPE template_status AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE template_type   AS ENUM (
  'EMAIL_ALARM', 'EMAIL_REPORT', 'EMAIL_WELCOME',
  'RELEASE_NOTE', 'NOTIFICATION', 'INSIGHT'
);

CREATE TABLE templates (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(255) NOT NULL,
  tenant_id    UUID         NOT NULL,
  name         VARCHAR(500) NOT NULL,
  type         template_type NOT NULL,
  status       template_status NOT NULL DEFAULT 'DRAFT',
  html_content TEXT         NOT NULL,
  description  TEXT,
  version      INTEGER      NOT NULL DEFAULT 1,
  created_by   UUID,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT templates_slug_tenant_unique UNIQUE (slug, tenant_id)
);

CREATE INDEX idx_templates_tenant_type   ON templates (tenant_id, type);
CREATE INDEX idx_templates_tenant_status ON templates (tenant_id, status);
```

> **Nota:** O campo `version` é incrementado automaticamente pelo repositório a cada `UPDATE` em `htmlContent`.

### 2. Entidade TypeScript

```typescript
export type TemplateType =
  | 'EMAIL_ALARM'
  | 'EMAIL_REPORT'
  | 'EMAIL_WELCOME'
  | 'RELEASE_NOTE'
  | 'NOTIFICATION'
  | 'INSIGHT';

export type TemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export interface Template {
  id: string;
  slug: string;
  tenantId: string;
  name: string;
  type: TemplateType;
  status: TemplateStatus;
  htmlContent: string;
  description?: string;
  version: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Template without htmlContent — usado em listagens para evitar payloads grandes */
export type TemplateSummary = Omit<Template, 'htmlContent'>;
```

### 3. Endpoints REST

#### Templates CRUD

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `POST` | `/templates` | JWT | Cria novo template |
| `GET` | `/templates` | JWT | Lista templates (filtros: `type`, `status`) |
| `GET` | `/templates/:slug` | JWT | Retorna template completo |
| `PUT` | `/templates/:slug` | JWT | Atualiza name, status, htmlContent ou description |
| `DELETE` | `/templates/:slug` | JWT | Arquiva o template (soft delete) |

#### Endpoints especializados

| Método | Path | Auth | Descrição |
|---|---|---|---|
| `POST` | `/templates/:slug/preview` | JWT | Renderiza o template com dados de teste |
| `GET` | `/templates/active` | JWT / API Key | Retorna o template `ACTIVE` de um type (`?type=EMAIL_ALARM`) |
| `GET` | `/templates/tag-catalog` | JWT | Lista as tags disponíveis para um type (`?type=NOTIFICATION`) |

#### Exemplos de request/response

**`POST /templates`**
```json
{
  "slug": "alarm-email-pt-br",
  "name": "E-mail de Alarme — Português BR",
  "type": "EMAIL_ALARM",
  "status": "ACTIVE",
  "htmlContent": "<html>...{{summary.rulesCount}} rules dispararam...</html>",
  "description": "Template padrão para notificações de alarme em português"
}
```

**`GET /templates/tag-catalog?type=NOTIFICATION`**
```json
[
  { "tag": "{{notification.title}}",  "label": "Título da notificação", "description": "Título principal da notificação", "example": "Alarme crítico detectado" },
  { "tag": "{{notification.level}}",  "label": "Nível de severidade",   "description": "INFO | WARNING | ERROR | SUCCESS", "example": "WARNING" },
  ...
]
```

**`GET /templates/active?type=EMAIL_ALARM`**

Retorna o único template `ACTIVE` para o type informado no tenant do contexto. Retorna `404` se não houver nenhum.

### 4. Template Engine

O engine é implementado internamente em `TemplateService.ts` sem dependências externas.

#### Regras de renderização

| Sintaxe | Comportamento |
|---|---|
| `{{caminho.aninhado}}` | Substituído pelo valor resolvido no objeto de dados via dot-notation. Valor `null`/`undefined` → string vazia. |
| `{{#each lista}}...{{/each}}` | Repete o bloco HTML para cada item da lista. O item fica disponível no contexto pelo nome no singular (ex.: `rules` → `rule`). |
| Loops aninhados | Suportados com profundidade arbitrária (ex.: `{{#each rules}}...{{#each rule.devices}}...{{/each}}...{{/each}}`). |

#### Funções internas

```typescript
// Resolve dot-notation no objeto de dados
function resolvePath(obj: Record<string, unknown>, path: string): unknown

// Infere o nome singular da coleção (rules → rule, items → item)
function getSingularName(collectionPath: string): string

// Localiza o primeiro bloco {{#each}} com suporte a aninhamento correto
function findFirstEachBlock(template: string): { before, collectionPath, body, after } | null

// Substitui {{variáveis}} sem tocar em {{#each}} / {{/each}}
function renderVariables(template: string, ctx: Record<string, unknown>): string

// Ponto de entrada recursivo: processa loops e variáveis
function renderBlock(template: string, ctx: Record<string, unknown>): string

// API pública do engine
export function renderTemplate(htmlContent: string, data: Record<string, unknown>): string
```

---

## Hybrid Payload Standard

### Motivação

Com 6 tipos de template e múltiplos serviços consumidores (alarm-orchestrator, relatórios, welcome, etc.), é necessário um **data contract** claro para o objeto `data` passado ao `renderTemplate`. O Hybrid Payload Standard define:

- Um **envelope compartilhado** com campos presentes em todos os tipos.
- **Campos type-specific** adicionados ao mesmo objeto (não encapsulados em namespace extra).

### Envelope universal

Todo payload de renderização deve conter:

```json
{
  "platform": {
    "name": "MYIO",
    "url": "https://app.myio.com.br"
  },
  "customer": {
    "id": "uuid-do-customer",
    "name": "Nome do Cliente"
  },
  "user": {
    "name": "Nome do Usuário",
    "email": "usuario@empresa.com"
  }
}
```

> `user` pode ser omitido em templates que não envolvem usuários específicos (ex.: `EMAIL_REPORT` gerado por job).

### Payloads por tipo

#### `EMAIL_ALARM`

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Dimension Engenharia" },
  "user":     { "name": "Rodrigo Oliveira", "email": "rodrigo@myio.com.br" },
  "summary": {
    "rulesCount":   3,
    "devicesCount": 7
  },
  "gateway": {
    "name": "MessageGatewayMestreAlvaro",
    "type": "MESSAGE_GATEWAY"
  },
  "rules": [
    {
      "name":        "Fancoil Ligado Fora do Horario",
      "description": "Fancoil permanece ligado fora do horário",
      "condition":   "Valor > 100",
      "emails":      "rodrigo@myio.com.br, victor@myio.com.br",
      "devices": [
        {
          "name":      "Fancoil Sala Reuniao 01",
          "value":     "450",
          "status":    "online",
          "timestamp": "05/03/2026 10:54:45"
        }
      ]
    }
  ]
}
```

#### `EMAIL_REPORT`

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Dimension Engenharia" },
  "report": {
    "title":       "Relatório Mensal — Março 2026",
    "period":      "01/03/2026 a 31/03/2026",
    "generatedAt": "05/03/2026 08:00:00"
  },
  "summary": {
    "totalAlarms":   42,
    "activeDevices": 128
  },
  "items": [
    { "label": "Energia Total", "value": "12.450 kWh" },
    { "label": "Água Total",    "value": "380 m³" }
  ]
}
```

#### `EMAIL_WELCOME`

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Dimension Engenharia" },
  "user": {
    "name":  "João Silva",
    "email": "joao@empresa.com"
  },
  "activation": {
    "link":      "https://app.myio.com.br/activate?token=abc123",
    "expiresAt": "07/03/2026 18:00:00"
  }
}
```

#### `RELEASE_NOTE`

```json
{
  "platform":            { "name": "MYIO", "url": "https://app.myio.com.br" },
  "version":             "v0.1.428",
  "period":              "Março 2026",
  "moduleName":          "Módulo de Energia",
  "featureTitle":        "Exportação de Dados em PDF, XLS e CSV",
  "featureSubtitle":     "Disponível no topo de cada painel",
  "overviewText":        "O MYIO agora permite exportar dados de qualquer painel...",
  "highlightPanelLabel": "Coluna Área Comum — 69 dispositivos",
  "highlightMetric":     "48.932 MWh",
  "formats": [
    { "label": "PDF", "description": "Relatório visual formatado" },
    { "label": "XLS", "description": "Planilha editável" },
    { "label": "CSV", "description": "Dados brutos para integração" }
  ],
  "panels": [
    { "name": "Área Comum",   "deviceCount": "69" },
    { "name": "Bloco A — P1", "deviceCount": "24" }
  ],
  "steps": [
    { "number": "1", "text": "Acesse o painel desejado" },
    { "number": "2", "text": "Clique no ícone de exportação no canto superior direito" },
    { "number": "3", "text": "Escolha o formato e confirme" }
  ],
  "highlights": [
    { "label": "CHILLER 1",     "value": "12.429 MWh", "description": "25.4% do total" },
    { "label": "TORRE DE RESFR","value": "8.103 MWh",  "description": "16.6% do total" }
  ]
}
```

#### `NOTIFICATION`

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Dimension Engenharia" },
  "user":     { "name": "João Silva", "email": "joao@empresa.com" },
  "notification": {
    "title":       "Alarme crítico detectado",
    "body":        "O dispositivo Fancoil 01 excedeu o limite configurado.",
    "level":       "WARNING",
    "actionLabel": "Ver detalhes",
    "actionUrl":   "https://app.myio.com.br/alarms/123"
  }
}
```

> **`notification.level`** aceita: `INFO` | `WARNING` | `ERROR` | `SUCCESS`

#### `INSIGHT`

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Dimension Engenharia" },
  "insight": {
    "title":   "Resumo de Consumo — Março 2026",
    "period":  "01/03/2026 a 31/03/2026",
    "summary": "O consumo total aumentou 12% em relação ao mês anterior."
  },
  "metrics": [
    { "label": "Consumo Total", "value": "12.450", "unit": "kWh", "trend": "UP" },
    { "label": "Demanda Máx.",  "value": "48.2",   "unit": "kW",  "trend": "STABLE" },
    { "label": "Água",          "value": "380",     "unit": "m³",  "trend": "DOWN" }
  ],
  "recommendations": [
    {
      "title": "Reduzir consumo em horário de ponta",
      "text":  "Considere desligar equipamentos entre 18h e 21h para evitar demanda elevada."
    },
    {
      "title": "Verificar vazamentos no circuito de água",
      "text":  "A queda de 15% no consumo de água pode indicar vazamento no subsolo."
    }
  ]
}
```

> **`metric.trend`** aceita: `UP` | `DOWN` | `STABLE`

### Regras do Standard

1. **`platform` é obrigatório** em todos os tipos.
2. **`customer` é obrigatório** em todos os tipos exceto `RELEASE_NOTE` (enviado para todos os clientes, sem personalização de customer).
3. **`user` é opcional** — incluir quando o template é personalizado por usuário.
4. Campos não presentes no payload retornam string vazia no HTML renderizado (nunca lançam erro).
5. O engine não valida o payload contra o tipo do template — responsabilidade do consumidor.

---

### 5. Tag Catalog por tipo

O endpoint `GET /templates/tag-catalog?type=<TYPE>` retorna a lista de tags disponíveis para um tipo, incluindo tags de controle de loop (`{{#each}}`, `{{/each}}`).

#### `NOTIFICATION` — Tags disponíveis

| Tag | Label | Exemplo |
|---|---|---|
| `{{notification.title}}` | Título da notificação | `Alarme crítico detectado` |
| `{{notification.body}}` | Corpo da notificação | `O dispositivo Fancoil 01 excedeu...` |
| `{{notification.level}}` | Nível de severidade | `WARNING` |
| `{{notification.actionLabel}}` | Label do botão de ação | `Ver detalhes` |
| `{{notification.actionUrl}}` | URL da ação | `https://app.myio.com.br/alarms/123` |
| `{{user.name}}` | Nome do usuário | `João Silva` |
| `{{customer.name}}` | Nome do cliente | `Dimension Engenharia` |
| `{{platform.name}}` | Nome da plataforma | `MYIO` |

#### `INSIGHT` — Tags disponíveis

| Tag | Label | Exemplo |
|---|---|---|
| `{{insight.title}}` | Título do insight | `Resumo de Consumo — Março 2026` |
| `{{insight.period}}` | Período de análise | `01/03/2026 a 31/03/2026` |
| `{{insight.summary}}` | Resumo executivo | `O consumo total aumentou 12%...` |
| `{{customer.name}}` | Nome do cliente | `Dimension Engenharia` |
| `{{#each metrics}}` | Loop — métricas | — |
| `{{metric.label}}` | Label da métrica | `Consumo Total` |
| `{{metric.value}}` | Valor da métrica | `12.450` |
| `{{metric.unit}}` | Unidade da métrica | `kWh` |
| `{{metric.trend}}` | Tendência (UP/DOWN/STABLE) | `UP` |
| `{{#each recommendations}}` | Loop — recomendações | — |
| `{{recommendation.title}}` | Título da recomendação | `Reduzir consumo em horário de ponta` |
| `{{recommendation.text}}` | Texto da recomendação | `Considere desligar equipamentos...` |
| `{{/each}}` | Fecha qualquer loop | — |

---

## Migration Strategy

### Banco de dados

A migration é incremental — cada tipo novo é adicionado ao CHECK constraint sem DROP da tabela:

```
1. html-templates.sql              — cria tabela com tipos EMAIL_ALARM, EMAIL_REPORT, EMAIL_WELCOME
2. add-release-note-template-type.sql — adiciona RELEASE_NOTE
3. add-notification-insight-template-types.sql — adiciona NOTIFICATION e INSIGHT
```

Para rodar a migration mais recente:

```bash
psql $DATABASE_URL -f scripts/db/migrations/add-notification-insight-template-types.sql
```

### Seeds

Templates de exemplo são carregados via `scripts/db/seeds/20-templates.sql`. Para tipos `NOTIFICATION` e `INSIGHT`, criar seeds com status `DRAFT` para validação antes de ativar em produção.

---

## Drawbacks

1. **Engine próprio:** o engine não suporta condicionais (`{{#if}}`), filtros ou helpers. Para templates que precisem de lógica condicional, o consumidor deve pré-processar os dados ou utilizar CSS para ocultar elementos vazios.

2. **Sem isolamento de erros de template:** um template malformado (ex.: `{{#each` sem `{{/each}}`) retorna HTML parcialmente renderizado. Recomenda-se usar o endpoint `preview` para validar templates antes de ativá-los.

3. **`version` não é imutável:** o campo `version` é incrementado a cada update, mas versões anteriores não são preservadas. Para rastreabilidade de versões, considerar RFC futura de histórico de templates.

---

## Alternatives Considered

### A. Handlebars.js (biblioteca externa)

Biblioteca madura com suporte a helpers, partials e condicionais.

**Rejeitado:** adiciona dependência externa, aumenta bundle e introduz superficie de ataque. O engine próprio atende os casos de uso atuais com código auditável.

### B. Template engine no serviço consumidor

Cada serviço (alarm-orchestrator, relatórios) mantém seus próprios templates e engine.

**Rejeitado:** duplica lógica, impossibilita gerenciamento central por tenant e dificulta auditoria de qual HTML foi enviado.

### C. Templates em arquivo (filesystem)

Templates armazenados como arquivos `.html` no repositório, carregados em runtime.

**Rejeitado:** impede personalização por tenant, exige deploy para qualquer alteração de template e não suporta versionamento por cliente.

---

## Unresolved Questions

1. **Versionamento imutável:** devo implementar um histórico de versões de templates (tabela `template_versions`)? Isso permitiria auditar qual versão exata de HTML gerou um e-mail específico. Ver RFC futura.

2. **Validação de tags no save:** devo validar no `POST /templates` que o `htmlContent` só usa tags do `TAG_CATALOG` do tipo informado? Risco: rejeitar templates válidos com tags customizadas do consumidor.

3. **Templates globais vs. por tenant:** atualmente todos os templates são por `tenantId`. Faz sentido ter templates globais (tenant `00000000-...`) que sirvam como fallback?

4. **`NOTIFICATION` como push ou e-mail?** O tipo `NOTIFICATION` pode ser usado tanto para e-mail de notificação quanto para push notification (payload simplificado). A semântica final depende de como o alarm-orchestrator consome o template.

---

## Future Possibilities

- **RFC-XXXX — Template Version History:** preservar versões anteriores imutáveis com lookup por `slug@version`.
- **Condicionais `{{#if}}`:** adicionar suporte a blocos condicionais no engine para eliminar a necessidade de pré-processar dados no consumidor.
- **Template inheritance / partials:** suporte a `{{> partial-name}}` para reutilizar headers e footers entre templates.
- **Preview com dados sintéticos automáticos:** o endpoint `preview` gera automaticamente dados de exemplo baseado no `TAG_CATALOG` do tipo, sem necessidade de o usuário enviar `data`.
- **Editor visual:** interface drag-and-drop no admin GCDR para montar templates usando as tags do catálogo como blocos visuais.
