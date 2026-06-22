# Frontend Guide — Templates Engine (RFC-0021 v2)

> **Para:** Time de Frontend
> **Versão:** 2.0 — 2026-03-16
> **Relacionado:** `docs/BACKEND-RFC-0021-HTML-Templates-v2.md`, `docs/EMAIL-SENDER-PAYLOAD-CONTRACT.md`

---

## Conceito

Templates são arquivos HTML que definem a estrutura visual de emails enviados pelo sistema (alarmes, relatórios, boas-vindas, releases, etc.). Themes (Look & Feel) fornecem os estilos visuais (cores, logo, tipografia) injetados como CSS variables no HTML.

### Hierarquia de resolução

Para cada envio de email, o sistema resolve **template** e **theme** na seguinte ordem:

```
Template:
  1. Template do customer alvo (customer_id + type + status=ACTIVE)
  2. Template do customer pai (sobe parentCustomerId)
  3. Template padrão do tenant (customer_id IS NULL) ← sempre existe

Theme:
  1. Theme do customer vinculado ao tipo (customer_id + template_type = type + is_default)
  2. Theme genérico padrão do customer (customer_id + template_type IS NULL + is_default)
  3. Theme padrão do customer pai (sobe parentCustomerId)
  4. Theme padrão MYIO (fallback final) ← sempre existe
```

---

## Tipos de Template

| Tipo | Uso |
|---|---|
| `EMAIL_ALARM` | Notificação de alarme disparado |
| `EMAIL_REPORT` | Relatório periódico |
| `EMAIL_WELCOME` | Boas-vindas / reset de senha |
| `RELEASE_NOTE` | Comunicado de nova feature |
| `NOTIFICATION` | Notificação avulsa de sistema |
| `INSIGHT` | Resumo de insights e métricas |

---

## Endpoints

**Base URL:** `/api/v1`
**Auth:** `Authorization: Bearer <jwt>` + `X-Tenant-Id: <uuid>`

---

### CRUD de Templates

#### Listar templates

```
GET /templates?type=EMAIL_ALARM&status=ACTIVE
```

Retorna `TemplateSummary[]` (sem `htmlContent` para performance).

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "slug": "alarm-notification-v1",
        "tenantId": "...",
        "customerId": null,
        "name": "Notificação de Alarme",
        "type": "EMAIL_ALARM",
        "status": "ACTIVE",
        "version": 3,
        "createdAt": "2026-03-01T...",
        "updatedAt": "2026-03-10T..."
      }
    ],
    "count": 1
  }
}
```

> `customerId: null` = template padrão do tenant. `customerId: "uuid"` = override de customer específico.

---

#### Buscar template por slug

```
GET /templates/:slug
```

Retorna o template completo incluindo `htmlContent`.

---

#### Criar template

```
POST /templates
```

```json
{
  "slug": "alarm-notification-mestrealvaro",
  "name": "Alarme — Mestre Álvaro",
  "type": "EMAIL_ALARM",
  "status": "DRAFT",
  "customerId": "84e0370e-636a-4741-9874-504b5e0b3577",
  "htmlContent": "<!DOCTYPE html>...",
  "description": "Template customizado para Mestre Álvaro"
}
```

- `customerId`: omitir ou `null` para template do tenant; UUID para override de customer
- `slug`: lowercase, hífens, 3–255 chars. Único por `(tenant + customer + type)`.

**Restrições:**
- Só pode existir **um** template por `(tenant, type)` com `customerId = null`
- Só pode existir **um** template por `(tenant, customerId, type)` por customer

---

#### Atualizar template

```
PUT /templates/:slug
```

```json
{
  "name": "Alarme v2",
  "status": "ACTIVE",
  "htmlContent": "<!DOCTYPE html>...novo conteúdo..."
}
```

Qualquer alteração em `htmlContent` incrementa o campo `version` automaticamente.

---

#### Arquivar template (soft delete)

```
DELETE /templates/:slug
```

Seta `status: ARCHIVED`. Retorna `204 No Content`.

---

### Preview (Editor)

```
POST /templates/:slug/preview
```

Renderiza o template com dados de preview. Usar para o editor em tempo real.

```json
{
  "customerId": "84e0370e-...",
  "data": {
    "platform": { "name": "MYIO", "url": "https://app.myio.com.br" },
    "customer": { "id": "uuid", "name": "Mestre Álvaro Engenharia" },
    "summary": { "rulesCount": 2, "devicesCount": 3 },
    "gateway": { "name": "GW-MestreAlvaro", "type": "MESSAGE_GATEWAY" },
    "rules": [
      {
        "name": "Fancoil Ligado",
        "description": "...",
        "condition": "Valor == 1",
        "emails": "rodrigo@myio.com.br",
        "devices": [
          { "name": "Fancoil 01", "value": "1", "status": "online", "timestamp": "16/03/2026 10:54:00" }
        ]
      }
    ]
  }
}
```

**Response:**
```json
{ "success": true, "data": { "html": "<!DOCTYPE html>...HTML renderizado..." } }
```

---

### Catálogo de Tags (Editor)

```
GET /templates/tag-catalog?type=EMAIL_ALARM
```

Retorna as tags disponíveis para uso no editor HTML, com label e exemplo.

```json
{
  "success": true,
  "data": [
    { "tag": "{{summary.rulesCount}}", "label": "Qtd. de rules disparadas", "description": "...", "example": "3" },
    { "tag": "{{#each rules}}", "label": "Loop — abre bloco de rules", "description": "...", "example": "" },
    ...
  ]
}
```

---

### Render para EMAIL_SENDER

#### GET (retorna template + theme, sem dados)

```
GET /templates/render?type=EMAIL_ALARM&customerId=84e0370e-...
GET /templates/render?type=EMAIL_ALARM&customerId=84e0370e-...&version=3
```

Auth aceita também `X-API-Key: gcdr_pk_*` (M2M).

**Response:**
```json
{
  "success": true,
  "data": {
    "html": "<!DOCTYPE html>...<style>:root { --color-primary: #0D47A1; }</style>...",
    "template": {
      "id": "uuid",
      "slug": "alarm-notification-v1",
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

**Headers de resposta:**
```
X-Template-Version: 3
X-Template-Source: tenant
X-Theme-Source: customer_default
```

**`templateSource` valores:**

| Valor | Significado |
|---|---|
| `customer` | Template próprio do customer |
| `parent_customer` | Template de um customer pai na hierarquia |
| `tenant` | Template padrão do tenant (fallback) |

**`themeSource` valores:**

| Valor | Significado |
|---|---|
| `customer_type` | Theme do customer vinculado ao tipo específico |
| `customer_default` | Theme genérico padrão do customer |
| `parent_default` | Theme padrão de um customer pai |
| `tenant` | Theme padrão MYIO (fallback final) |

#### POST (retorna HTML com dados já renderizados)

```
POST /templates/render
```

```json
{
  "type": "EMAIL_ALARM",
  "customerId": "84e0370e-...",
  "data": { ... payload conforme EMAIL-SENDER-PAYLOAD-CONTRACT ... }
}
```

---

## Themes (Look & Feel)

Os themes são gerenciados pela API de Look & Feel. Endpoints relevantes:

```
GET    /themes?customerId=uuid
POST   /themes
PATCH  /themes/:id
DELETE /themes/:id
POST   /themes/:id/set-default
```

### Criando um theme para customer com tipo específico

```json
{
  "customerId": "84e0370e-...",
  "name": "Tema Alarme — Mestre Álvaro",
  "templateType": "EMAIL_ALARM",
  "isDefault": true,
  "mode": "light",
  "colors": {
    "primary": "#C62828",
    "primaryLight": "#E53935",
    "background": "#FFFFFF",
    "textPrimary": "#212121"
  },
  "typography": {
    "fontFamily": "Inter, sans-serif"
  },
  "logo": {
    "primaryUrl": "https://cdn.mestrealvaro.com.br/logo.png"
  },
  "brandName": "Mestre Álvaro Engenharia"
}
```

- `templateType: "EMAIL_ALARM"` → theme usado apenas para emails de alarme
- `templateType: null` → theme genérico (usado para qualquer tipo sem match específico)
- `isDefault: true` → marca como o theme ativo para o customer + templateType

---

## Sintaxe de Tags nos Templates

| Sintaxe | Comportamento |
|---|---|
| `{{caminho.aninhado}}` | Substituição via dot-notation. Valor ausente → string vazia. |
| `{{#each lista}}...{{/each}}` | Loop sobre array. Item referenciado pelo singular (`rules` → `rule`). |
| Loops aninhados | Suportados: `{{#each rules}}...{{#each rule.devices}}...{{/each}}...{{/each}}` |

### CSS Variables injetadas pelo theme

O sistema injeta um bloco `<style data-gcdr-theme="...">` no `<head>` com as variáveis do theme:

```css
:root {
  --color-primary:   #C62828;
  --color-secondary: #B71C1C;
  --color-background: #FFFFFF;
  --color-text:      #212121;
  --logo-url:        url('https://cdn.mestrealvaro.com.br/logo.png');
  --brand-name:      "Mestre Álvaro Engenharia";
  --font-family:     "Inter, sans-serif";
}
```

Use `var(--color-primary)` no HTML do template para que o theme seja aplicado.

---

## Referências

- **Backend RFC:** `docs/BACKEND-RFC-0021-HTML-Templates-v2.md`
- **Payload contract EMAIL_SENDER:** `docs/EMAIL-SENDER-PAYLOAD-CONTRACT.md`
- **Seeds de templates:** `scripts/db/seeds/20-templates.sql`, `21-release-note-template.sql`
- **Seeds de themes:** `scripts/db/seeds/19-themes.sql`
