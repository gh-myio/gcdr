# Frontend Guide — Temas por Tipo de Template

> **Para:** Time de Frontend
> **Status da API:** Implementado e disponível
> **Base URL (local):** `http://localhost:3015/api/v1`
> **Base URL (prod):** `https://gcdr-server.apps.myio-bas.com/api/v1`
> **Auth:** Todas as rotas exigem `Authorization: Bearer <jwt>` + `X-Tenant-Id: <uuid>`

---

## 1. O que mudou

A funcionalidade de temas (`look_and_feels`) foi expandida. Antes, cada customer tinha
**um tema padrão** (`is_default = true`). Agora é possível ter **múltiplos temas por
customer**, cada um associado a um **tipo de template de e-mail** específico.

Isso significa que o Mestre Álvaro pode ter:

| Tema | Tipo | Uso |
|---|---|---|
| Mestre Álvaro — Padrão | `null` (global) | App UI + fallback de e-mail |
| Mestre Álvaro — Alarmes | `EMAIL_ALARM` | E-mails de alarme com destaque em vermelho |
| Mestre Álvaro — Insights | `INSIGHT` | E-mails analíticos com verde corporativo |

### Nova coluna em `LookAndFeel`

```ts
interface LookAndFeel {
  // ... campos existentes ...

  templateType?: string   // null = tema global; 'EMAIL_ALARM' | 'NOTIFICATION' | etc.
  isDefault: boolean      // continua existindo para o tema global
}
```

### Regra de unicidade

Para um mesmo customer, só pode existir **um tema por `templateType`**.
Criar um segundo tema com o mesmo `templateType` retorna `409 Conflict`.

---

## 2. Tipos de Template (`/template-types`)

Os tipos de template são as categorias canônicas de e-mail da plataforma.
Eles ficam numa tabela própria com `label`, `description` e `icon` editáveis.

### 2.1 Listar todos os tipos

```
GET /api/v1/template-types
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "type": "EMAIL_ALARM",
        "label": "Alerta de Alarme",
        "description": "Enviado quando um alarme é disparado por uma regra de monitoramento. Contém resumo dos dispositivos afetados, condição violada e destinatários configurados na regra.",
        "icon": "bell-alert",
        "sortOrder": 1,
        "active": true,
        "createdAt": "2026-03-06T00:00:00.000Z",
        "updatedAt": "2026-03-06T00:00:00.000Z"
      },
      {
        "type": "EMAIL_REPORT",
        "label": "Relatório Periódico",
        "description": "Enviado com resumo de consumo e indicadores do período configurado.",
        "icon": "chart-bar",
        "sortOrder": 2,
        "active": true,
        "createdAt": "...",
        "updatedAt": "..."
      },
      {
        "type": "EMAIL_WELCOME",
        "label": "Boas-vindas",
        "description": "Enviado ao novo usuário com link de ativação e instruções iniciais.",
        "icon": "envelope-open",
        "sortOrder": 3,
        "active": true,
        "createdAt": "...",
        "updatedAt": "..."
      },
      {
        "type": "RELEASE_NOTE",
        "label": "Novidade de Versão",
        "description": "Comunicado de nova funcionalidade ou versão da plataforma MYIO.",
        "icon": "sparkles",
        "sortOrder": 4,
        "active": true,
        "createdAt": "...",
        "updatedAt": "..."
      },
      {
        "type": "NOTIFICATION",
        "label": "Notificação Geral",
        "description": "Mensagem avulsa de alerta, informação ou ação direcionada ao usuário.",
        "icon": "bell",
        "sortOrder": 5,
        "active": true,
        "createdAt": "...",
        "updatedAt": "..."
      },
      {
        "type": "INSIGHT",
        "label": "Insight de Consumo",
        "description": "Análise automática de consumo com métricas e recomendações de economia.",
        "icon": "light-bulb",
        "sortOrder": 6,
        "active": true,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "total": 6
  }
}
```

### 2.2 Buscar um tipo específico

```
GET /api/v1/template-types/EMAIL_ALARM
```

Retorna o objeto de um único tipo. Útil para exibir detalhes na tela de configuração.

### 2.3 Editar label / descrição / ícone

```
PATCH /api/v1/template-types/EMAIL_ALARM
Content-Type: application/json

{
  "label": "Alarme Ativo",
  "description": "Novo texto customizado para exibir no frontend.",
  "icon": "fire-alert",
  "sortOrder": 1,
  "active": true
}
```

Todos os campos são opcionais. O `type` (chave) é imutável.

**Casos de uso no frontend:**
- Tela de configurações de notificações → exibir nome e descrição de cada tipo
- Seletor de tipo ao criar um novo tema → usar `label` + `icon`
- Admin MYIO pode personalizar os textos sem deploy

---

## 3. Temas por Tipo (`/themes`)

### 3.1 Criar tema com tipo específico

```
POST /api/v1/themes
Content-Type: application/json

{
  "customerId": "e04046d4-baa4-44e9-a378-4dfebe4140f1",
  "name": "Mestre Álvaro — Alarmes",
  "templateType": "EMAIL_ALARM",
  "isDefault": false,
  "mode": "light",
  "colors": {
    "primary":     "#C62828",
    "secondary":   "#1A3A5C",
    "accent":      "#E8B84B",
    "background":  "#F5F6F8",
    "surface":     "#FFFFFF",
    "error":       "#C62828",
    "warning":     "#E65100",
    "success":     "#2E7D32",
    "info":        "#0277BD",
    "textPrimary": "#1A1F36",
    "textSecondary":"#4A5568"
  },
  "logo": {
    "primaryUrl": "https://mestrealvaro.com.br/assets/logo.svg"
  },
  "inheritFromParent": false,
  "metadata": {}
}
```

> **Regra:** `templateType` + `customerId` devem ser únicos.
> Criar um segundo tema com `templateType: "EMAIL_ALARM"` para o mesmo customer retorna `409`.

### 3.2 Criar tema global (sem tipo)

Para criar o tema padrão do app (sem vínculo com e-mail), basta omitir `templateType` ou passar `null`:

```json
{
  "customerId": "...",
  "name": "Mestre Álvaro — Padrão",
  "templateType": null,
  "isDefault": true,
  ...
}
```

### 3.3 Listar temas de um customer

```
GET /api/v1/customers/:customerId/themes
```

A resposta inclui o campo `templateType` em cada item, permitindo ao frontend
distinguir temas globais de temas por tipo:

```json
{
  "data": {
    "items": [
      { "id": "...", "name": "Mestre Álvaro — Padrão",   "templateType": null,          "isDefault": true  },
      { "id": "...", "name": "Mestre Álvaro — Alarmes",   "templateType": "EMAIL_ALARM", "isDefault": false },
      { "id": "...", "name": "Mestre Álvaro — Insights",  "templateType": "INSIGHT",     "isDefault": false }
    ]
  }
}
```

### 3.4 Atualizar um tema existente

```
PUT /api/v1/themes/:id
Content-Type: application/json

{
  "templateType": "EMAIL_REPORT",
  "colors": { "primary": "#1565C0" }
}
```

---

## 4. Fallback de Tema para E-mails

Quando o serviço `EMAIL_SENDER` busca o tema para renderizar um e-mail, o GCDR
percorre esta cadeia de prioridade:

```
1. Tema do customer com templateType = tipo do e-mail
          ↓ não encontrado
2. Tema do customer com templateType = null e is_default = true
          ↓ não encontrado
3. Tema do customer MYIO Platform com templateType = tipo do e-mail
          ↓ não encontrado
4. Tema do customer MYIO Platform com templateType = null e is_default = true
          ↓ não encontrado
5. Nenhum tema — HTML renderizado sem variáveis de cor
```

**Implicação para o frontend:**
- Se o customer não tiver nenhum tema configurado, os e-mails usam o visual padrão MYIO.
- Para personalizar apenas os e-mails de alarme de um customer, basta criar um tema com
  `templateType = "EMAIL_ALARM"`. Os demais tipos continuam usando o tema global.

---

## 5. Tela de Configuração de Temas — Sugestão de UX

```
Configurações de Tema — Mestre Álvaro
├── Tema Padrão (App + E-mails sem tema específico)
│   └── [Editar]  [Visualizar]
│
├── Temas por Tipo de E-mail
│   ├── EMAIL_ALARM  — "Alerta de Alarme"
│   │   └── [Nenhum — usar padrão]  [+ Criar tema]
│   │
│   ├── EMAIL_REPORT — "Relatório Periódico"
│   │   └── [Nenhum — usar padrão]  [+ Criar tema]
│   │
│   ├── EMAIL_WELCOME — "Boas-vindas"
│   │   └── Mestre Álvaro — Boas-vindas  [Editar]  [Remover]
│   │
│   ├── RELEASE_NOTE — "Novidade de Versão"
│   │   └── [Nenhum — usar padrão]  [+ Criar tema]
│   │
│   ├── NOTIFICATION — "Notificação Geral"
│   │   └── [Nenhum — usar padrão]  [+ Criar tema]
│   │
│   └── INSIGHT — "Insight de Consumo"
│       └── Mestre Álvaro — Insights  [Editar]  [Remover]
```

Para montar esta tela:
1. Chame `GET /template-types` → lista os tipos com label e ícone
2. Chame `GET /customers/:id/themes` → lista os temas do customer
3. Cruze os dois: para cada tipo, verifique se existe um tema com `templateType === type`
4. Exiba o status: com tema próprio → mostra o nome e botão editar; sem tema → "usar padrão" + botão criar

---

## 6. Referência Rápida de Endpoints

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/template-types` | Lista todos os tipos de template |
| `GET` | `/template-types/:type` | Detalhe de um tipo (ex: `EMAIL_ALARM`) |
| `PATCH` | `/template-types/:type` | Edita label, descrição, ícone, sort_order |
| `GET` | `/customers/:id/themes` | Lista todos os temas do customer |
| `GET` | `/customers/:id/themes/default` | Tema global padrão do customer |
| `POST` | `/themes` | Cria tema (global ou por tipo via `templateType`) |
| `PUT` | `/themes/:id` | Atualiza tema completo |
| `DELETE` | `/themes/:id` | Remove tema |
| `POST` | `/themes/:id/set-default` | Define tema global como padrão do customer |

---

## 7. Campos de `templateType` nos DTOs

### Criar tema (`POST /themes`)

```ts
{
  customerId:     string          // obrigatório
  name:           string          // obrigatório
  templateType?:  string | null   // opcional — null = tema global
  isDefault?:     boolean         // padrão: false
  mode?:          'light' | 'dark' | 'system'
  colors:         ColorPalette    // obrigatório
  logo:           LogoConfig      // obrigatório
  // ... demais campos de tema
}
```

### Atualizar tipo de template (`PATCH /template-types/:type`)

```ts
{
  label?:       string          // máx 100 chars
  description?: string | null   // máx 1000 chars
  icon?:        string | null   // nome do ícone (sem prefixo, ex: "bell-alert")
  sortOrder?:   number          // inteiro >= 0
  active?:      boolean
}
```

---

## 8. Considerações

- O campo `type` em `template_types` é **imutável** — não há endpoint de criação ou exclusão
  de tipos. Os 6 tipos são definidos pela plataforma.
- O campo `icon` é uma string livre — o frontend decide qual biblioteca de ícones usar.
  A convenção atual é usar nomes do **Heroicons** (ex: `bell-alert`, `chart-bar`, `light-bulb`).
- Temas com `templateType` definido **não aparecem** na seleção de tema padrão do app.
  Eles só são usados pelo `EMAIL_SENDER` ao renderizar e-mails.
