# Backend RFC — HTML Templates Engine (RFC-0021)

> **Para:** Time de Backend
> **Status:** Proposta — aguardando implementação
> **Relacionado:** RFC-0020 (Public Single Apps)
> **Data:** 2026-03-05

---

## 1. Contexto

O sistema MYIO precisa de um motor de templates HTML para geração e envio de notificações por email (alarmes, relatórios, etc.).

**Problema atual:**
- O template de email de alarme está hardcoded no backend
- Não é possível personalizar sem deploy
- Não há histórico de versões nem preview antes de ativar

**O que muda:**
- Os templates são cadastrados e editados via API
- O frontend GCDR oferece um editor HTML com catálogo de tags ao lado
- O backend renderiza as tags com dados reais e envia o email
- É possível ter múltiplos templates por tipo e ativar/desativar sem deploy

---

## 2. Entidade `Template`

```typescript
interface Template {
  id: string;               // UUID
  slug: string;             // identificador único, ex: "alarm-notification-v1"
  name: string;             // nome legível
  type: TemplateType;       // enum — define quais tags estão disponíveis
  status: TemplateStatus;
  htmlContent: string;      // HTML com tags {{...}} — campo TEXT no banco (sem limite)
  description?: string;
  version: number;          // incrementa a cada PUT
  createdAt: string;        // ISO 8601
  updatedAt: string;
  createdBy?: string;
}

type TemplateType =
  | 'EMAIL_ALARM'     // notificação de alarme disparado
  | 'EMAIL_REPORT'    // relatórios periódicos
  | 'EMAIL_WELCOME';  // boas-vindas / onboarding

type TemplateStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
```

> **Importante:** `htmlContent` deve ser armazenado como `TEXT` (PostgreSQL) — **não** `jsonb` nem `varchar`. Templates podem ter 20–50 KB.

---

## 3. Endpoints

> Todas as rotas exigem `Authorization: Bearer <jwt>` + `X-Tenant-Id: <uuid>`

### 3.1 CRUD

#### `POST /api/v1/templates`
Cria um novo template.

**Request:**
```json
{
  "slug": "alarm-notification-v1",
  "name": "Alarm Notification Email",
  "type": "EMAIL_ALARM",
  "status": "DRAFT",
  "description": "Template de notificação de alarme disparado",
  "htmlContent": "<!DOCTYPE html><html>...{{summary.rulesCount}}...</html>"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "slug": "alarm-notification-v1",
    "name": "Alarm Notification Email",
    "type": "EMAIL_ALARM",
    "status": "DRAFT",
    "htmlContent": "<!DOCTYPE html>...",
    "description": "...",
    "version": 1,
    "createdAt": "2026-03-05T10:00:00.000Z",
    "updatedAt": "2026-03-05T10:00:00.000Z"
  }
}
```

**Erros:**
- `409 CONFLICT` — slug já existe

---

#### `GET /api/v1/templates`
Lista templates. Filtros via query string.

**Query params:**
```
?type=EMAIL_ALARM&status=ACTIVE
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "items": [ /* array de Template (sem htmlContent para não pesar a listagem) */ ],
    "count": 5
  }
}
```

> **Sugestão:** omitir `htmlContent` na listagem — retornar só em `GET /templates/:slug`.

---

#### `GET /api/v1/templates/:slug`
Retorna o template completo incluindo `htmlContent`.

**Response `200`:** Objeto `Template` completo.

---

#### `PUT /api/v1/templates/:slug`
Atualiza o template. Todos os campos são opcionais. Incrementa `version`.

**Request:**
```json
{
  "name": "Alarm Notification Email v2",
  "status": "ACTIVE",
  "htmlContent": "<!DOCTYPE html>...novo conteúdo..."
}
```

---

#### `DELETE /api/v1/templates/:slug`
Soft delete — seta `status: ARCHIVED`. Retorna `204 No Content`.

---

### 3.2 Preview (crítico para o editor)

#### `POST /api/v1/templates/:slug/preview`
Renderiza o template com dados fornecidos e retorna o HTML pronto.
Usado pelo frontend para exibir o preview em tempo real no editor.

**Request:**
```json
{
  "data": {
    "summary": {
      "rulesCount": 3,
      "devicesCount": 7
    },
    "gateway": {
      "name": "MessageGatewayMestreAlvaro",
      "type": "MESSAGE_GATEWAY"
    },
    "rules": [
      {
        "name": "Fancoil Ligado Fora do Horario (Seg - Dom)",
        "description": "Fancoil permanece ligado fora do horario permitido de operacao",
        "condition": "Valor > 100",
        "emails": "rodrigo@myio.com.br, victor@myio.com.br",
        "devices": [
          {
            "name": "Fancoil Sala Reuniao 01",
            "value": 450,
            "status": "online",
            "timestamp": "05/03/2026 10:54:45"
          },
          {
            "name": "Fancoil Sala Reuniao 02",
            "value": 380,
            "status": "online",
            "timestamp": "05/03/2026 10:54:45"
          }
        ]
      },
      {
        "name": "Temperatura Elevada - Elevador",
        "description": "Temperatura do motor do elevador acima do limite",
        "condition": "Valor > 80",
        "emails": "rodrigo@myio.com.br",
        "devices": [
          {
            "name": "Elevador Torre A - Motor Principal",
            "value": 87,
            "status": "online",
            "timestamp": "05/03/2026 10:54:45"
          }
        ]
      }
    ]
  }
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "html": "<!DOCTYPE html><html>...HTML renderizado com dados reais...</html>"
  }
}
```

---

### 3.3 Catálogo de Tags

#### `GET /api/v1/templates/tags/:type`
Retorna as tags disponíveis para um tipo de template.
Usado pelo editor no frontend para exibir o painel de tags ao lado do editor HTML.

**Exemplo:** `GET /api/v1/templates/tags/EMAIL_ALARM`

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "tag": "{{summary.rulesCount}}",
      "label": "Qtd. de rules disparadas",
      "description": "Número total de rules que dispararam no evento",
      "example": "3"
    },
    {
      "tag": "{{summary.devicesCount}}",
      "label": "Qtd. de dispositivos alarmados",
      "description": "Número total de dispositivos afetados",
      "example": "7"
    },
    {
      "tag": "{{gateway.name}}",
      "label": "Nome do gateway",
      "description": "Nome do gateway que originou o alarme",
      "example": "MessageGatewayMestreAlvaro"
    },
    {
      "tag": "{{gateway.type}}",
      "label": "Tipo do gateway",
      "description": "Tipo do gateway",
      "example": "MESSAGE_GATEWAY"
    },
    {
      "tag": "{{#each rules}}",
      "label": "Loop — abre bloco de rules",
      "description": "Repete o bloco HTML para cada rule disparada",
      "example": ""
    },
    {
      "tag": "{{rule.name}}",
      "label": "Nome da rule",
      "description": "Dentro de {{#each rules}}",
      "example": "Fancoil Ligado Fora do Horario"
    },
    {
      "tag": "{{rule.description}}",
      "label": "Descrição da rule",
      "description": "Dentro de {{#each rules}}",
      "example": "Fancoil permanece ligado fora do horario"
    },
    {
      "tag": "{{rule.condition}}",
      "label": "Condição da rule",
      "description": "Dentro de {{#each rules}}",
      "example": "Valor > 100"
    },
    {
      "tag": "{{rule.emails}}",
      "label": "Emails notificados",
      "description": "Dentro de {{#each rules}} — lista separada por vírgula",
      "example": "rodrigo@myio.com.br, victor@myio.com.br"
    },
    {
      "tag": "{{#each rule.devices}}",
      "label": "Loop — abre bloco de devices",
      "description": "Dentro de {{#each rules}} — repete para cada device",
      "example": ""
    },
    {
      "tag": "{{device.name}}",
      "label": "Nome do device",
      "description": "Dentro de {{#each rule.devices}}",
      "example": "Fancoil Sala Reuniao 01"
    },
    {
      "tag": "{{device.value}}",
      "label": "Valor medido",
      "description": "Dentro de {{#each rule.devices}}",
      "example": "450"
    },
    {
      "tag": "{{device.status}}",
      "label": "Status do device",
      "description": "Dentro de {{#each rule.devices}} — 'online' ou 'offline'",
      "example": "online"
    },
    {
      "tag": "{{device.timestamp}}",
      "label": "Data/hora do alarme",
      "description": "Dentro de {{#each rule.devices}}",
      "example": "05/03/2026 10:54:45"
    },
    {
      "tag": "{{/each}}",
      "label": "Loop — fecha bloco",
      "description": "Fecha {{#each rules}} ou {{#each rule.devices}}",
      "example": ""
    }
  ]
}
```

---

## 4. Sintaxe de Tags

O motor de templates usa sintaxe estilo Handlebars:

| Sintaxe | Função |
|---|---|
| `{{variavel}}` | Substitui pelo valor da variável |
| `{{#each lista}}` | Abre loop — repete o bloco para cada item |
| `{{/each}}` | Fecha o loop |
| `{{#if condicao}}` | Condicional (opcional, fase 2) |
| `{{/if}}` | Fecha o if |

### Exemplo de uso no HTML

```html
<!-- Tags simples -->
<div>{{summary.rulesCount}}</div>
<div>{{gateway.name}}</div>

<!-- Loop de rules -->
{{#each rules}}
<div>🔔 {{rule.name}}</div>
<div>{{rule.description}}</div>
<span>Condição: {{rule.condition}}</span>
<span>✉️ {{rule.emails}}</span>

  <!-- Loop de devices (aninhado dentro do loop de rules) -->
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

## 5. Integração com Disparo de Alarmes

Quando rules disparam, o backend deve:

1. Buscar o template `ACTIVE` do tipo `EMAIL_ALARM` para o tenant
2. Montar o payload de dados com as rules e devices afetados
3. Renderizar internamente (mesmo motor do endpoint `/preview`)
4. Enviar via SMTP/SES

```
Rule dispara
  → busca template ACTIVE de tipo EMAIL_ALARM do tenant
  → monta payload { summary, gateway, rules[] }
  → renderiza HTML
  → envia email
```

Se não existir template `ACTIVE` para o tenant, usa o template default do sistema (fallback).

---

## 6. Prioridade de Implementação

| # | Endpoint | Prioridade | Motivo |
|---|---|---|---|
| 1 | `POST /templates` | 🔴 Crítico | Criar templates |
| 2 | `GET /templates/:slug` | 🔴 Crítico | Editor precisa carregar o conteúdo |
| 3 | `PUT /templates/:slug` | 🔴 Crítico | Salvar edições |
| 4 | `POST /templates/:slug/preview` | 🔴 Crítico | Preview em tempo real no editor |
| 5 | `GET /templates/tags/:type` | 🟡 Importante | Catálogo de tags no editor |
| 6 | `GET /templates` | 🟡 Importante | Listagem |
| 7 | `DELETE /templates/:slug` | 🟢 Normal | Arquivar |
| 8 | Integração com disparo de alarmes | 🟢 Normal | Pode usar template hardcoded enquanto |

---

## 7. Banco de Dados (sugestão)

```sql
CREATE TABLE templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        VARCHAR(255) NOT NULL UNIQUE,
  tenant_id   UUID NOT NULL,
  name        VARCHAR(500) NOT NULL,
  type        VARCHAR(50)  NOT NULL,   -- EMAIL_ALARM | EMAIL_REPORT | EMAIL_WELCOME
  status      VARCHAR(50)  NOT NULL DEFAULT 'DRAFT',
  html_content TEXT        NOT NULL,   -- TEXT, não jsonb
  description VARCHAR(1000),
  version     INTEGER      NOT NULL DEFAULT 1,
  created_by  UUID,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_tenant_type_status ON templates (tenant_id, type, status);
```

---

## 8. Referências

- **Template de exemplo:** `logs/sample.html` (alarm notification com dados mock)
- **RFC relacionado:** `docs/FRONTEND-RFC-0020-Public-Single-Apps.md`
