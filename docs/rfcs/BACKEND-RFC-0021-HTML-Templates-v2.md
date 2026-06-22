# Backend RFC — HTML Templates Engine v2 (RFC-0021)

> **Para:** Time de Backend
> **Versão:** 2.0 — atualizado em 2026-03-06
> **Status:** Implementado + novos endpoints pendentes
> **Relacionado:** RFC-0021 (spec completa), `docs/EMAIL-SENDER-PAYLOAD-CONTRACT.md`

---

## O que mudou da v1

| Item | v1 | v2 |
|---|---|---|
| Tipos de template | 3 (`EMAIL_ALARM`, `EMAIL_REPORT`, `EMAIL_WELCOME`) | 6 (+`RELEASE_NOTE`, `NOTIFICATION`, `INSIGHT`) |
| Endpoint catálogo de tags | `GET /templates/tags/:type` | `GET /templates/tag-catalog?type=X` |
| Endpoint para EMAIL_SENDER | Não existia | `GET /templates/render?type=X&customerId=Y` (novo — ver §3.4) |
| Merge com theme do customer | Não existia | Sim — com fallback para theme MYIO padrão |
| Versionamento no render | Não existia | `?version=N` opcional |
| Payload examples | Só EMAIL_ALARM | Todos os 6 tipos |

---

## 1. Entidade `Template`

```typescript
type TemplateType =
  | 'EMAIL_ALARM'    // notificação de alarme disparado
  | 'EMAIL_REPORT'   // relatórios periódicos
  | 'EMAIL_WELCOME'  // boas-vindas + reset de senha
  | 'RELEASE_NOTE'   // comunicado de nova feature
  | 'NOTIFICATION'   // notificação avulsa de sistema
  | 'INSIGHT';       // resumo de insights e métricas

type TemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

interface Template {
  id: string;
  slug: string;           // identificador único por (tenant + customer + type)
  tenantId: string;
  customerId?: string;    // null = template padrão do tenant; preenchido = override do customer
  name: string;
  type: TemplateType;
  status: TemplateStatus;
  htmlContent: string;    // TEXT no banco — pode ter 20–50 KB
  description?: string;
  version: number;        // incrementa a cada PUT com novo htmlContent
  createdBy?: string;
  createdAt: string;      // ISO 8601
  updatedAt: string;
}

/** Omite htmlContent — usado em listagens */
type TemplateSummary = Omit<Template, 'htmlContent'>;
```

---

## 2. Banco de Dados

### `templates`

```sql
CREATE TABLE templates (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(255)   NOT NULL,
  tenant_id    UUID           NOT NULL,
  customer_id  UUID           REFERENCES customers(id) ON DELETE CASCADE,
  -- NULL = template padrão do tenant; preenchido = override do customer
  name         VARCHAR(500)   NOT NULL,
  type         VARCHAR(50)    NOT NULL,  -- EMAIL_ALARM | EMAIL_REPORT | ...
  status       VARCHAR(50)    NOT NULL DEFAULT 'DRAFT',
  html_content TEXT           NOT NULL,
  description  TEXT,
  version      INTEGER        NOT NULL DEFAULT 1,
  created_by   UUID,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Templates de tenant (customer_id IS NULL): um por type por tenant
CREATE UNIQUE INDEX tmpl_tenant_type_unique
  ON templates (tenant_id, type)
  WHERE customer_id IS NULL;

-- Templates de customer: um por type por customer
CREATE UNIQUE INDEX tmpl_customer_type_unique
  ON templates (tenant_id, customer_id, type)
  WHERE customer_id IS NOT NULL;

-- Slug único por (tenant + customer) — NULL tratado como próprio namespace
CREATE UNIQUE INDEX tmpl_slug_tenant_customer_unique
  ON templates (slug, tenant_id, customer_id);

CREATE INDEX idx_templates_tenant_type   ON templates (tenant_id, type);
CREATE INDEX idx_templates_tenant_status ON templates (tenant_id, status);
```

> **Por que dois índices parciais em vez de UNIQUE (tenant_id, customer_id, type)?**
> No PostgreSQL, `NULL != NULL` em unique constraints normais — dois registros com `customer_id = NULL` e o mesmo `(tenant_id, type)` passariam sem erro. Os índices parciais resolvem isso corretamente.

### `look_and_feels`

A tabela já tem `customer_id` (FK → customers) e `template_type` (VARCHAR nullable). As regras de unicidade relevantes para resolução de theme:

```
UNIQUE (tenant_id, customer_id, template_type)  -- um theme por tipo por customer
-- NULL customer_id = theme padrão do tenant
-- NULL template_type = theme genérico (não vinculado a tipo específico)
-- is_default = true → selecionado como fallback quando não há match por tipo
```

> **Migrations incrementais:**
> 1. `html-templates.sql` — cria tabela com 3 tipos iniciais
> 2. `add-release-note-template-type.sql` — adiciona `RELEASE_NOTE`
> 3. `add-notification-insight-template-types.sql` — adiciona `NOTIFICATION` e `INSIGHT`
> 4. **`add-customer-id-to-templates.sql`** — adiciona `customer_id` + recria índices ⏳ A executar

---

## 3. Endpoints

> Auth: `Authorization: Bearer <jwt>` + `X-Tenant-Id: <uuid>`
> Exceção: `GET /templates/render` — aceita também `X-API-Key: gcdr_pk_*` (para serviços M2M como EMAIL_SENDER)

---

### 3.1 CRUD

#### `POST /api/v1/templates`

```json
// Request
{
  "slug": "alarm-pt-br-v1",
  "name": "Notificação de Alarme — PT-BR",
  "type": "EMAIL_ALARM",
  "status": "DRAFT",
  "description": "Template padrão de alarme em português",
  "htmlContent": "<!DOCTYPE html>...{{summary.rulesCount}}..."
}

// Response 201
{
  "success": true,
  "data": {
    "id": "uuid",
    "slug": "alarm-pt-br-v1",
    "name": "Notificação de Alarme — PT-BR",
    "type": "EMAIL_ALARM",
    "status": "DRAFT",
    "htmlContent": "...",
    "version": 1,
    "createdAt": "2026-03-06T10:00:00.000Z",
    "updatedAt": "2026-03-06T10:00:00.000Z"
  }
}
```

**Erros:** `409` — slug já existe para o tenant.

---

#### `GET /api/v1/templates`

**Query params:** `?type=EMAIL_ALARM&status=ACTIVE`

```json
// Response 200
{
  "success": true,
  "data": {
    "items": [
      /* TemplateSummary[] — sem htmlContent para não pesar */
    ],
    "count": 3
  }
}
```

---

#### `GET /api/v1/templates/:slug`

Retorna o template completo incluindo `htmlContent`.

```json
// Response 200
{
  "success": true,
  "data": { /* Template completo com htmlContent */ }
}
```

**Erros:** `404` — slug não encontrado.

---

#### `PUT /api/v1/templates/:slug`

Todos os campos opcionais. Se `htmlContent` for alterado, incrementa `version`.

```json
// Request
{
  "name": "Notificação de Alarme v2",
  "status": "ACTIVE",
  "htmlContent": "<!DOCTYPE html>...novo conteúdo..."
}
```

---

#### `DELETE /api/v1/templates/:slug`

Soft delete — seta `status: ARCHIVED`. Retorna `204 No Content`.

---

### 3.2 Preview

#### `POST /api/v1/templates/:slug/preview`

Renderiza o template com dados fornecidos. Usado pelo editor frontend para preview em tempo real.

O campo `data` deve seguir o **Hybrid Payload Standard** do tipo do template (ver §5).

```json
// Request — exemplo para EMAIL_ALARM
{
  "data": {
    "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
    "customer": { "id": "uuid", "name": "Dimension Engenharia" },
    "summary": { "rulesCount": 2, "devicesCount": 3 },
    "gateway": { "name": "MessageGatewayMestreAlvaro", "type": "MESSAGE_GATEWAY" },
    "rules": [
      {
        "name": "Fancoil Ligado Fora do Horario",
        "description": "Fancoil permanece ligado fora do horario permitido",
        "condition": "Valor == 1",
        "emails": "rodrigo@myio.com.br, victor@myio.com.br",
        "devices": [
          { "name": "Fancoil Sala Reuniao 01", "value": "1", "status": "online", "timestamp": "06/03/2026 10:54:00" }
        ]
      }
    ]
  }
}

// Response 200
{
  "success": true,
  "data": {
    "html": "<!DOCTYPE html><html>...HTML renderizado com dados reais...</html>"
  }
}
```

---

### 3.3 Catálogo de Tags

#### `GET /api/v1/templates/tag-catalog?type=EMAIL_ALARM`

Retorna as tags disponíveis para um tipo. Usado pelo editor frontend para exibir o painel de tags ao lado do HTML.

```json
// Response 200
{
  "success": true,
  "data": [
    { "tag": "{{summary.rulesCount}}",  "label": "Qtd. de rules disparadas",       "description": "Número total de rules que dispararam", "example": "3" },
    { "tag": "{{summary.devicesCount}}","label": "Qtd. de dispositivos alarmados",  "description": "Número total de dispositivos afetados", "example": "7" },
    { "tag": "{{gateway.name}}",        "label": "Nome do gateway",                 "description": "Nome do gateway que originou o alarme", "example": "MessageGatewayMestreAlvaro" },
    { "tag": "{{#each rules}}",         "label": "Loop — abre bloco de rules",      "description": "Repete o bloco HTML para cada rule",    "example": "" },
    { "tag": "{{rule.name}}",           "label": "Nome da rule",                    "description": "Dentro de {{#each rules}}",             "example": "Fancoil Ligado Fora do Horario" },
    { "tag": "{{rule.emails}}",         "label": "Emails notificados",              "description": "Dentro de {{#each rules}} — string separada por vírgula", "example": "rodrigo@myio.com.br, victor@myio.com.br" },
    { "tag": "{{#each rule.devices}}",  "label": "Loop — devices da rule",          "description": "Dentro de {{#each rules}}",             "example": "" },
    { "tag": "{{device.name}}",         "label": "Nome do device",                  "description": "Dentro de {{#each rule.devices}}",      "example": "Fancoil Sala Reuniao 01" },
    { "tag": "{{device.value}}",        "label": "Valor medido",                    "description": "Dentro de {{#each rule.devices}}",      "example": "450" },
    { "tag": "{{device.status}}",       "label": "Status do device",               "description": "Dentro de {{#each rule.devices}} — online ou offline", "example": "online" },
    { "tag": "{{device.timestamp}}",    "label": "Data/hora do alarme",             "description": "Dentro de {{#each rule.devices}}",      "example": "06/03/2026 10:54:00" },
    { "tag": "{{/each}}",               "label": "Loop — fecha bloco",              "description": "Fecha qualquer {{#each}}",              "example": "" }
  ]
}
```

> Tipos disponíveis: `EMAIL_ALARM`, `EMAIL_REPORT`, `EMAIL_WELCOME`, `RELEASE_NOTE`, `NOTIFICATION`, `INSIGHT`

---

### 3.4 Render para EMAIL_SENDER ⚠️ NOVO — A IMPLEMENTAR

#### `GET /api/v1/templates/render`

Endpoint exclusivo para o serviço `EMAIL_SENDER`. Retorna o HTML do template ativo para um tipo, já **mesclado com o theme do customer** (cores, logo, fontes).

**Query params:**

| Param | Obrigatório | Descrição |
|---|---|---|
| `type` | ✅ | `TemplateType` — ex: `EMAIL_ALARM` |
| `customerId` | ✅ | UUID do customer alvo |
| `version` | ❌ | Versão específica do template. Se omitido, usa o `ACTIVE` mais recente. |

**Exemplos:**

```
GET /api/v1/templates/render?type=EMAIL_ALARM&customerId=84e0370e-...
GET /api/v1/templates/render?type=EMAIL_ALARM&customerId=84e0370e-...&version=3
```

**Auth:** `X-API-Key: gcdr_pk_*` (M2M) ou `Authorization: Bearer <jwt>`

---

#### Resolução de Template (ordem de prioridade)

```
1. (tenant_id, customer_id, type, status=ACTIVE)       ← template próprio do customer
2. (tenant_id, parent_customer_id, type, status=ACTIVE) ← template do customer pai
   → sobe parent_customer_id até encontrar ou chegar no root
3. (tenant_id, NULL, type, status=ACTIVE)              ← template padrão do tenant ← SEMPRE EXISTE
```

Se `?version=N` informado: busca por `(tenant_id, customer_id, type, version=N)` diretamente, sem fallback hierárquico.

#### Resolução de Theme (ordem de prioridade)

```
1. look_and_feels WHERE customer_id = $customerId
                   AND template_type = $type
                   AND is_default = true              ← theme do customer para o tipo específico

2. look_and_feels WHERE customer_id = $customerId
                   AND template_type IS NULL
                   AND is_default = true              ← theme genérico padrão do customer

3. look_and_feels WHERE customer_id = $parentCustomerId
                   AND template_type IS NULL
                   AND is_default = true              ← theme padrão do customer pai
   → sobe parent_customer_id até encontrar ou chegar no root

4. look_and_feels WHERE customer_id IS NULL
                   AND tenant_id = $tenantId
                   AND is_default = true              ← theme padrão do tenant ← SEMPRE EXISTE
```

#### Merge do theme no HTML

O theme é injetado como CSS custom properties no `<head>` do template:

```html
<style>
  :root {
    --color-primary:   #0D47A1;
    --color-secondary: #1976D2;
    --color-header-bg: #0D47A1;
    --color-text:      #212121;
    --logo-url:        "https://cdn.myio.com.br/logos/mestrealvaro.png";
    --brand-name:      "Mestre Álvaro Engenharia";
    --font-family:     "Inter, sans-serif";
  }
</style>
```

Os templates HTML usam essas variáveis diretamente via `var(--color-primary)`.

---

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "html": "<!DOCTYPE html>...<style>:root { --color-primary: #0D47A1; } ...</style>...",
    "template": {
      "id": "uuid",
      "slug": "alarm-pt-br-v1",
      "type": "EMAIL_ALARM",
      "version": 3,
      "status": "ACTIVE",
      "customerId": null
    },
    "theme": {
      "id": "uuid",
      "name": "Tema Padrão Mestre Álvaro",
      "customerId": "84e0370e-..."
    },
    "templateSource": "tenant",
    "themeSource": "customer_default"
  }
}
```

**`templateSource`:**

| Valor | Significado |
|---|---|
| `"customer"` | Template próprio do customer alvo |
| `"parent_customer"` | Template herdado de um customer pai |
| `"tenant"` | Template padrão do tenant (fallback final) |

**`themeSource`:**

| Valor | Significado |
|---|---|
| `"customer_type"` | Theme do customer vinculado ao tipo específico |
| `"customer_default"` | Theme genérico padrão do customer |
| `"parent_default"` | Theme padrão de um customer pai |
| `"tenant"` | Theme padrão do tenant (fallback final) |

---

**Erros:**

```json
// 404 — nenhum template ativo encontrado (tenant não tem template padrão para o tipo)
{
  "success": false,
  "error": {
    "code": "TEMPLATE_NOT_FOUND",
    "message": "No ACTIVE template found for type EMAIL_ALARM",
    "type": "EMAIL_ALARM",
    "customerId": "84e0370e-..."
  }
}

// 404 — versão específica não encontrada
{
  "success": false,
  "error": {
    "code": "TEMPLATE_VERSION_NOT_FOUND",
    "message": "Template version 7 not found for type EMAIL_ALARM",
    "type": "EMAIL_ALARM",
    "version": 7
  }
}
```

**Cache recomendado (responsabilidade do EMAIL_SENDER):**

O EMAIL_SENDER deve cachear a resposta por `(customerId + type)` por X minutos. Os headers facilitam invalidação seletiva:

```
X-Template-Version: 3
X-Template-Source: tenant
X-Theme-Source: customer_default
```

---

## 4. Sintaxe de Tags

| Sintaxe | Comportamento |
|---|---|
| `{{caminho.aninhado}}` | Substituído via dot-notation. Valor ausente → string vazia (nunca erro). |
| `{{#each lista}}...{{/each}}` | Repete o bloco para cada item. Item disponível pelo nome no singular (`rules` → `rule`). |
| Loops aninhados | Suportados em profundidade arbitrária. Ex: `{{#each rules}}...{{#each rule.devices}}...{{/each}}...{{/each}}` |
| `{{#if}}` | **Não suportado na v1.** Fase futura. |

```html
<!-- Variável simples -->
<strong>{{summary.rulesCount}}</strong> rules disparadas

<!-- Loop com nested loop -->
{{#each rules}}
  <h3>{{rule.name}}</h3>
  <p>{{rule.description}}</p>
  {{#each rule.devices}}
    <tr>
      <td>{{device.name}}</td>
      <td>{{device.value}}</td>
      <td>{{device.status}}</td>
      <td>{{device.timestamp}}</td>
    </tr>
  {{/each}}
{{/each}}
```

---

## 5. Payloads por Tipo (Hybrid Payload Standard)

O campo `data` passado ao `POST /templates/:slug/preview` deve seguir este padrão por tipo.
O mesmo padrão é usado pelo `EMAIL_SENDER` internamente ao renderizar.

> Referência completa: `docs/EMAIL-SENDER-PAYLOAD-CONTRACT.md`

### EMAIL_ALARM

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Mestre Álvaro Engenharia" },
  "summary": { "rulesCount": 2, "devicesCount": 3, "alarmStatus": "OPENED" },
  "gateway": { "name": "MessageGatewayMestreAlvaro", "type": "MESSAGE_GATEWAY" },
  "rules": [
    {
      "name": "Fancoil Ligado Fora do Horario",
      "description": "Fancoil permanece ligado fora do horario permitido",
      "condition": "Valor == 1",
      "emails": "rodrigo@myio.com.br, victor@myio.com.br",
      "devices": [
        { "name": "Fancoil Sala Reuniao 01", "value": "1", "status": "online", "timestamp": "06/03/2026 10:54:00" },
        { "name": "Fancoil Sala Reuniao 02", "value": "1", "status": "online", "timestamp": "06/03/2026 10:54:00" }
      ]
    },
    {
      "name": "Temperatura Elevada - Elevador",
      "description": "Temperatura do motor do elevador acima do limite",
      "condition": "Valor > 80",
      "emails": "rodrigo@myio.com.br",
      "devices": [
        { "name": "Elevador Torre A - Motor Principal", "value": "85", "status": "online", "timestamp": "06/03/2026 10:54:00" }
      ]
    }
  ]
}
```

> **Nota:** o `EMAIL_SENDER` recebe `alarmRecipients: string[]` do ALARMS-API e converte para `emails: string` (join com vírgula) antes de chamar o preview/render.

---

### EMAIL_REPORT

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Mestre Álvaro Engenharia" },
  "report": {
    "title": "Relatório Mensal — Março 2026",
    "period": "01/03/2026 a 31/03/2026",
    "generatedAt": "06/03/2026 08:00:00"
  },
  "summary": { "totalAlarms": 42, "activeDevices": 128 },
  "items": [
    { "label": "Energia Total",   "value": "12.450 kWh" },
    { "label": "Água Total",      "value": "380 m³" },
    { "label": "Alarmes Abertos", "value": "3" }
  ]
}
```

---

### EMAIL_WELCOME

Usado para `NEW_USER` e `PASSWORD_RESET` — mesmo template, conteúdo do `activation.link` diferente.

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Mestre Álvaro Engenharia" },
  "user": { "name": "João Silva", "email": "joao@mestrealvaro.com.br" },
  "activation": {
    "link": "https://app.myio.com.br/activate?token=abc123xyz",
    "expiresAt": "08/03/2026 18:00:00"
  }
}
```

---

### RELEASE_NOTE

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "version": "v0.1.428",
  "period": "Março 2026",
  "moduleName": "Módulo de Energia",
  "featureTitle": "Exportação de Dados em PDF, XLS e CSV",
  "featureSubtitle": "Disponível no topo de cada painel",
  "overviewText": "O MYIO agora permite exportar dados de qualquer painel...",
  "highlightPanelLabel": "Coluna Área Comum — 69 dispositivos",
  "highlightMetric": "48.932 MWh",
  "formats": [
    { "label": "PDF", "description": "Relatório visual formatado" },
    { "label": "XLS", "description": "Planilha editável" },
    { "label": "CSV", "description": "Dados brutos para integração" }
  ],
  "steps": [
    { "number": "1", "text": "Acesse o painel desejado" },
    { "number": "2", "text": "Clique no ícone de exportação" },
    { "number": "3", "text": "Escolha o formato e confirme" }
  ],
  "highlights": [
    { "label": "CHILLER 1",      "value": "12.429 MWh", "description": "25.4% do total" },
    { "label": "TORRE DE RESFR", "value": "8.103 MWh",  "description": "16.6% do total" }
  ]
}
```

---

### NOTIFICATION

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Mestre Álvaro Engenharia" },
  "user": { "name": "João Silva", "email": "joao@mestrealvaro.com.br" },
  "notification": {
    "title": "Manutenção programada — 07/03/2026",
    "body": "O sistema estará em manutenção das 02h às 04h. Salve seus dados antes desse horário.",
    "level": "INFO",
    "actionLabel": "Ver detalhes",
    "actionUrl": "https://app.myio.com.br/notices/123"
  }
}
```

> `notification.level`: `INFO` | `WARNING` | `ERROR` | `SUCCESS`

---

### INSIGHT

```json
{
  "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
  "customer": { "id": "uuid", "name": "Mestre Álvaro Engenharia" },
  "insight": {
    "title": "Resumo de Consumo — Março 2026",
    "period": "01/03/2026 a 31/03/2026",
    "summary": "O consumo total aumentou 12% em relação ao mês anterior."
  },
  "metrics": [
    { "label": "Consumo Total", "value": "12.450", "unit": "kWh", "trend": "UP" },
    { "label": "Demanda Máx.",  "value": "48.2",   "unit": "kW",  "trend": "STABLE" },
    { "label": "Água",          "value": "380",     "unit": "m³",  "trend": "DOWN" }
  ],
  "recommendations": [
    { "title": "Reduzir consumo em horário de ponta", "text": "Considere desligar equipamentos entre 18h e 21h." },
    { "title": "Verificar circuito de água",          "text": "Queda de 15% pode indicar vazamento no subsolo." }
  ]
}
```

> `metric.trend`: `UP` | `DOWN` | `STABLE`

---

## 6. TypeScript Interfaces — EmailSenderPayload

O contrato de payload está tipado em código em:

```
src/dto/request/EmailSenderPayload.ts
```

Esse arquivo define uma **discriminated union** por `type`, garantindo que cada payload tenha o shape correto em TypeScript. Exemplo de uso:

```typescript
import { EmailSenderPayload, isEmailSenderPayload } from '../dto/request/EmailSenderPayload';

function handlePayload(raw: unknown) {
  if (!isEmailSenderPayload(raw)) throw new Error('Invalid payload');

  // TypeScript narrowing automático por type
  switch (raw.type) {
    case 'ALARM_OPENED':
      // raw.data.rules[] — tipado como AlarmRule[]
      break;
    case 'NEW_USER':
      // raw.data.user.email — tipado como string
      break;
    case 'NOTIFICATION':
      // raw.data.notification.level — tipado como 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS'
      break;
  }
}
```

**Tipos exportados:**

| Export | Descrição |
|---|---|
| `EmailSenderPayload` | Union discriminada de todos os 8 tipos |
| `EmailEventType` | Enum de tipos: `'ALARM_OPENED' \| 'NEW_USER' \| ...` |
| `AlarmOpenedPayload` | Payload específico para alarme aberto |
| `AlarmClosedPayload` | Payload específico para alarme fechado |
| `NewUserPayload` | Payload para novo usuário |
| `PasswordResetPayload` | Payload para reset de senha |
| `ReportReadyPayload` | Payload para relatório gerado |
| `ReleaseNotePayload` | Payload para release note |
| `NotificationPayload` | Payload para notificação avulsa |
| `InsightPayload` | Payload para insights |
| `NotificationLevel` | `'INFO' \| 'WARNING' \| 'ERROR' \| 'SUCCESS'` |
| `MetricTrend` | `'UP' \| 'DOWN' \| 'STABLE'` |
| `isEmailSenderPayload()` | Type guard para validação de entrada |

---

## 7. Integração com EMAIL_SENDER — Fluxo Completo

```
Evento (ALARM_OPENED, NEW_USER, etc.)
  │
  ├─ [ALARMS-API ou GCDR]
  │   Normaliza o payload para o formato EMAIL-SENDER-PAYLOAD-CONTRACT
  │   POST → endpoint do EMAIL_SENDER com { type, customerId, tenantId, data }
  │
  ├─ [EMAIL_SENDER]
  │   1. Extrai type e customerId do envelope
  │   2. Verifica cache local (customerId + type) — se hit, pula step 3
  │   3. GET /api/v1/templates/render?type=EMAIL_ALARM&customerId=uuid
  │      ← HTML já com theme do customer mergeado
  │   4. Renderiza: substitui {{tags}} com os dados de data{}
  │   5. Extrai destinatários (varia por tipo — ver EMAIL-SENDER-PAYLOAD-CONTRACT.md)
  │   6. Envia via SMTP / SendGrid
```

**Mapeamento `type` → `templateType` GCDR:**

```
ALARM_OPENED    → EMAIL_ALARM
ALARM_CLOSED    → EMAIL_ALARM
NEW_USER        → EMAIL_WELCOME
PASSWORD_RESET  → EMAIL_WELCOME
REPORT_READY    → EMAIL_REPORT
RELEASE_NOTE    → RELEASE_NOTE
NOTIFICATION    → NOTIFICATION
INSIGHT         → INSIGHT
```

---

## 8. Prioridade de Implementação

| # | Endpoint / Tarefa | Prioridade | Status |
|---|---|---|---|
| 1 | `POST /templates` | 🔴 Crítico | ✅ Implementado |
| 2 | `GET /templates/:slug` | 🔴 Crítico | ✅ Implementado |
| 3 | `PUT /templates/:slug` | 🔴 Crítico | ✅ Implementado |
| 4 | `POST /templates/:slug/preview` | 🔴 Crítico | ✅ Implementado |
| 5 | `GET /templates/tag-catalog?type=X` | 🟡 Importante | ✅ Implementado |
| 6 | `GET /templates` | 🟡 Importante | ✅ Implementado |
| 7 | `DELETE /templates/:slug` | 🟢 Normal | ✅ Implementado |
| 8 | **Migration: `customer_id` em `templates`** | 🔴 Crítico | ⏳ **A implementar** |
| 9 | **`GET /templates/render?type=X&customerId=Y`** | 🔴 Crítico | ⏳ **A implementar** |
| 10 | Seeds para NOTIFICATION e INSIGHT | 🟡 Importante | ✅ Adicionados |
| 11 | Migration NOTIFICATION + INSIGHT | 🔴 Crítico | ✅ Script criado |

---

## 9. Referências

- **Spec completa do engine:** `docs/rfcs/RFC-0021-HTML-Templates-Engine.md`
- **Payload contract para EMAIL_SENDER:** `docs/EMAIL-SENDER-PAYLOAD-CONTRACT.md`
- **Seeds:** `scripts/db/seeds/20-templates.sql`
- **Migration:** `scripts/db/migrations/add-notification-insight-template-types.sql`
