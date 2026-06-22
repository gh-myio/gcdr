# Frontend Guide — Public Single Apps (RFC-0020)

> **Para:** Time de Frontend
> **Status da API:** Implementado e disponível
> **Base URL (local):** `http://localhost:3015/api/v1`
> **Base URL (prod):** `https://gcdr-server.apps.myio-bas.com/api/v1`
> **Auth:** Todas as rotas exigem `Authorization: Bearer <jwt>` + `X-Tenant-Id: <uuid>`

---

## 1. O que é este módulo?

O módulo **Public Single Apps** permite ao time MYIO cadastrar formulários HTML e coletar/gerenciar as respostas dos clientes de forma centralizada.

**Problema que resolve:**
- Hoje os formulários são enviados como arquivo `.html` por e-mail, o cliente preenche, manda o PDF de volta e o time MYIO transcreve manualmente.
- Não há histórico de revisões: quando o cliente altera uma resposta e reenvia, não se sabe o que mudou.

**O que muda:**
- O time cadastra o formulário no GCDR como um "app" (identificado por `slug`)
- O cliente acessa e preenche — a resposta vai direto para o banco via API
- Cada vez que o cliente atualiza, uma nova **versão** é criada, com **diff automático** do que mudou
- O time consulta tudo pelo painel: lista de respostas, histórico de versões, diff por campo

---

## 2. Conceitos Chave

| Conceito | O que é |
|---|---|
| **App** | O formulário em si (ex: "MYIO Migration Requirements Form v6"). Tem um `slug` único que vai na URL. |
| **Resposta** | Uma submissão do formulário — todos os campos preenchidos como JSON. |
| **Grupo de Resposta** (`responseGroupId`) | UUID que identifica "as respostas de um cliente específico" para aquele app. Agrupa todas as versões. |
| **Versão** (`responseVersion`) | Contador crescente (1, 2, 3…) de revisões dentro de um grupo. |
| **Última Versão** (`isLatest: true`) | Marcação que indica qual é a versão atual. Listagens retornam sempre `isLatest = true`. |
| **Diff** (`changesFromPrevious`) | Objeto automático com o que mudou de uma versão para a próxima, em dot-notation. |

### Fluxo típico

```
1. Admin MYIO cadastra o app
   → POST /public-apps

2. Admin compartilha o link com o cliente
   → O cliente acessa a tela do formulário no frontend

3. Cliente preenche e submete
   → POST /public-apps/:slug/responses
   → Cria responseGroupId (v1) + status SUBMITTED

4. Cliente faz correções e reenvia
   → POST /public-apps/:slug/responses/:groupId/revise
   → Cria v2 (a v1 vira isLatest=false) + changesFromPrevious calculado automaticamente

5. Time MYIO revisa, aprova ou rejeita
   → PATCH /public-apps/:slug/responses/:groupId/status
   → status: UNDER_REVIEW → APPROVED | REJECTED
```

---

## 3. Endpoints

> Todos requerem:
> ```http
> Authorization: Bearer <jwt>
> X-Tenant-Id: <tenant-uuid>
> Content-Type: application/json
> ```

---

### 3.1 Gestão de Apps

#### `POST /api/v1/public-apps`
Cadastra um novo app/formulário.

**Request:**
```json
{
  "slug": "myio-migration-form-v6",
  "name": "MYIO Migration Requirements Form v6",
  "description": "Formulário de levantamento de requisitos para migração MYIO",
  "status": "ACTIVE",
  "fieldsSchema": {},
  "metadata": {}
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-0000-0000-0000-000000000001",
    "slug": "myio-migration-form-v6",
    "name": "MYIO Migration Requirements Form v6",
    "description": "Formulário de levantamento de requisitos para migração MYIO",
    "fieldsSchema": {},
    "status": "ACTIVE",
    "metadata": {},
    "createdAt": "2026-03-04T10:00:00.000Z",
    "updatedAt": "2026-03-04T10:00:00.000Z",
    "createdBy": "user-uuid",
    "version": 1
  }
}
```

**Status do App:** `ACTIVE` | `INACTIVE` | `DRAFT` | `ARCHIVED`

---

#### `GET /api/v1/public-apps`
Lista todos os apps. Filtro opcional por status.

**Query params:**
```
?status=ACTIVE
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "items": [ /* array de App */ ],
    "count": 3
  }
}
```

---

#### `GET /api/v1/public-apps/:slug`
Retorna um app pelo slug.

**Response `200`:** Objeto `App` (mesmo formato do POST).

---

#### `PUT /api/v1/public-apps/:slug`
Atualiza metadados do app. Todos os campos são opcionais.

**Request:**
```json
{
  "name": "Novo Nome",
  "description": "Nova descrição",
  "status": "INACTIVE",
  "metadata": { "owner": "time-migracao" }
}
```

---

#### `DELETE /api/v1/public-apps/:slug`
Arquiva o app (soft delete — seta `status: ARCHIVED`). Retorna `204 No Content`.

---

### 3.2 Respostas

#### `POST /api/v1/public-apps/:slug/responses`
Submete uma resposta pela primeira vez. Cria um novo `responseGroupId` (v1).

**Request:**
```json
{
  "submittedBy": {
    "firstName": "João",
    "lastName": "Silva",
    "email": "joao@helexia.com",
    "company": "Helexia Brasil"
  },
  "formData": {
    "identification": {
      "empresa": "Helexia Brasil",
      "cnpj": "12.345.678/0001-90",
      "responsavel_tecnico": "João Silva",
      "email": "joao@helexia.com",
      "telefone": "(11) 99999-9999"
    },
    "volume": {
      "data_inicial": "2022-01-01",
      "data_final": "2025-01-01",
      "tamanho_banco": "50 GB"
    }
  },
  "metadata": {}
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "resp-uuid",
    "appId": "app-uuid",
    "responseGroupId": "group-uuid",
    "responseVersion": 1,
    "isLatest": true,
    "formData": { /* campos do formulário */ },
    "submittedBy": {
      "firstName": "João",
      "lastName": "Silva",
      "email": "joao@helexia.com",
      "company": "Helexia Brasil"
    },
    "changesFromPrevious": null,
    "changeNotes": null,
    "status": "SUBMITTED",
    "metadata": {},
    "createdAt": "2026-03-04T10:00:00.000Z",
    "updatedAt": "2026-03-04T10:00:00.000Z"
  }
}
```

> **Guardar `responseGroupId`!** É o ID que identifica "as respostas do João da Helexia" para este app. Todas as revisões futuras usam este mesmo groupId.

---

#### `POST /api/v1/public-apps/:slug/responses/:groupId/revise`
Cria uma nova revisão (v2, v3…) de uma resposta existente.

**Request:**
```json
{
  "submittedBy": {
    "firstName": "João",
    "lastName": "Silva",
    "email": "joao@helexia.com",
    "company": "Helexia Brasil"
  },
  "formData": {
    "identification": {
      "empresa": "Helexia Brasil",
      "cnpj": "12.345.678/0001-90",
      "responsavel_tecnico": "João Silva",
      "email": "joao@helexia.com",
      "telefone": "(11) 98888-0000"
    },
    "volume": {
      "data_inicial": "2022-01-01",
      "data_final": "2025-01-01",
      "tamanho_banco": "65 GB"
    }
  },
  "changeNotes": "Corrigido telefone e atualizado tamanho do banco após análise detalhada"
}
```

**Response `201`:** Mesmo formato do submit, com:
```json
{
  "responseVersion": 2,
  "isLatest": true,
  "changeNotes": "Corrigido telefone e atualizado tamanho do banco após análise detalhada",
  "changesFromPrevious": {
    "identification.telefone": { "from": "(11) 99999-9999", "to": "(11) 98888-0000" },
    "volume.tamanho_banco":    { "from": "50 GB",           "to": "65 GB" }
  }
}
```

---

#### `GET /api/v1/public-apps/:slug/responses`
Lista a versão mais recente (`isLatest=true`) de todas as respostas do app. Suporta paginação e filtros.

**Query params:**
```
?limit=20&offset=0&status=SUBMITTED&email=joao@helexia.com
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "items": [ /* array de Response (isLatest=true) */ ],
    "pagination": {
      "total": 45,
      "totalPages": 3,
      "hasMore": true,
      "nextCursor": "20"
    }
  }
}
```

---

#### `GET /api/v1/public-apps/:slug/responses/:groupId`
Retorna a versão mais recente de uma resposta específica.

---

#### `GET /api/v1/public-apps/:slug/responses/:groupId/history`
Retorna **todas** as versões de uma resposta (mais recente primeiro).

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "items": [
      { "responseVersion": 2, "isLatest": true, "changesFromPrevious": { ... } },
      { "responseVersion": 1, "isLatest": false, "changesFromPrevious": null }
    ],
    "count": 2
  }
}
```

---

#### `GET /api/v1/public-apps/:slug/responses/:groupId/version/:v`
Retorna uma versão específica (ex: `:v = 1`).

---

#### `PATCH /api/v1/public-apps/:slug/responses/:groupId/status`
Atualiza o status da última versão de uma resposta.

**Request:**
```json
{ "status": "APPROVED" }
```

**Status disponíveis:** `SUBMITTED` → `UNDER_REVIEW` → `APPROVED` | `REJECTED` | `ARCHIVED`

---

## 4. Tipos TypeScript

Copie estes tipos no seu projeto frontend:

```typescript
// Status

export type PublicAppStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT' | 'ARCHIVED';

export type ResponseStatus =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'ARCHIVED';

// Entidades

export interface SubmittedBy {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
}

export interface DiffEntry {
  from: unknown;
  to: unknown;
}

export interface PublicApp {
  id: string;
  slug: string;
  name: string;
  description?: string;
  fieldsSchema: Record<string, unknown>;
  status: PublicAppStatus;
  metadata: Record<string, unknown>;
  createdAt: string;   // ISO 8601
  updatedAt: string;
  createdBy?: string;
  version: number;
}

export interface PublicAppResponse {
  id: string;
  appId: string;
  responseGroupId: string;
  responseVersion: number;
  isLatest: boolean;
  formData: Record<string, unknown>;
  submittedBy: SubmittedBy;
  changesFromPrevious: Record<string, DiffEntry> | null;
  changeNotes?: string;
  status: ResponseStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

// DTOs de request

export interface CreateAppPayload {
  slug: string;
  name: string;
  description?: string;
  fieldsSchema?: Record<string, unknown>;
  status?: PublicAppStatus;
  metadata?: Record<string, unknown>;
}

export interface SubmitResponsePayload {
  submittedBy: SubmittedBy;
  formData: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ReviseResponsePayload extends SubmitResponsePayload {
  changeNotes?: string;
}

export interface ListResponsesParams {
  limit?: number;
  offset?: number;
  status?: ResponseStatus;
  email?: string;
}
```

---

## 5. Sugestão de Telas e Rotas

### Mapa de rotas (SPA)

```
/apps                              → Lista de Apps
/apps/new                          → Criar App
/apps/:slug                        → Detalhe do App + lista de respostas
/apps/:slug/edit                   → Editar App
/apps/:slug/responses/:groupId     → Detalhe da Resposta + histórico
```

---

### Tela 1 — Lista de Apps (`/apps`)

**O que mostra:**
- Tabela com: Nome, Slug, Status, Nº de respostas (se disponível), Data de criação, Ações
- Filtro por status (`ACTIVE`, `INACTIVE`, `DRAFT`, `ARCHIVED`)
- Botão "Novo App"

**Status badges sugeridos:**
```
ACTIVE   → verde
INACTIVE → cinza
DRAFT    → amarelo
ARCHIVED → vermelho/escuro
```

**API call:**
```
GET /api/v1/public-apps?status=ACTIVE
```

---

### Tela 2 — Criar / Editar App (`/apps/new`, `/apps/:slug/edit`)

**Formulário com campos:**
- `name` (obrigatório)
- `slug` (obrigatório, sugestão: gerar automaticamente a partir do nome, lowercase + hífens)
- `description` (textarea)
- `status` (select: ACTIVE | INACTIVE | DRAFT)
- `metadata` (editor JSON opcional — pode esconder para usuários básicos)

**Validações no frontend:**
- `slug`: apenas letras minúsculas, números e hífens (`/^[a-z0-9-]+$/`)
- Slug único (verificar erro 409 da API ao salvar)

**API calls:**
```
POST /api/v1/public-apps          (criar)
PUT  /api/v1/public-apps/:slug    (editar)
```

---

### Tela 3 — Detalhe do App + Respostas (`/apps/:slug`)

**Layout sugerido:**
```
┌─────────────────────────────────────────────────────────────┐
│  MYIO Migration Requirements Form v6         [ACTIVE] [Edit]│
│  Slug: myio-migration-form-v6                               │
│  Criado em: 04/03/2026                                      │
└─────────────────────────────────────────────────────────────┘

[Filtros: Status ▼] [Email ___________] [Buscar]

┌──────────────┬───────────────┬───────────┬───────┬──────────┐
│ Empresa      │ Email         │ Versão    │Status │ Data     │
├──────────────┼───────────────┼───────────┼───────┼──────────┤
│ Helexia      │ joao@hel...   │ v2        │APPROV.│ 04/03/26 │
│ Empresa XYZ  │ ana@xyz...    │ v1        │SUBMIT.│ 03/03/26 │
└──────────────┴───────────────┴───────────┴───────┴──────────┘
```

- Cada linha → link para `/apps/:slug/responses/:groupId`
- Coluna `Empresa` vem de `submittedBy.company`
- Coluna `Versão` exibe `v{responseVersion}` da última versão

**Status badges:**
```
SUBMITTED    → azul
UNDER_REVIEW → amarelo/laranja
APPROVED     → verde
REJECTED     → vermelho
ARCHIVED     → cinza
```

**API calls:**
```
GET /api/v1/public-apps/:slug
GET /api/v1/public-apps/:slug/responses?limit=20&offset=0
```

---

### Tela 4 — Detalhe da Resposta + Histórico (`/apps/:slug/responses/:groupId`)

**Layout sugerido:**
```
┌─────────────────────────────────────────────────────────────┐
│  Resposta: Helexia Brasil               [APPROVED ▼]        │
│  João Silva <joao@helexia.com>  •  Helexia Brasil           │
│  responseGroupId: a3b4c5d6-...                              │
└─────────────────────────────────────────────────────────────┘

[Versão Atual: v2 ●]  [v1]

┌─── Dados do Formulário ─────────────────────────────────────┐
│  identification.empresa:        Helexia Brasil              │
│  identification.responsavel:    João Silva                  │
│  volume.tamanho_banco:          65 GB        ← mudou (v1: 50 GB)│
└─────────────────────────────────────────────────────────────┘

┌─── Histórico de Versões ────────────────────────────────────┐
│  v2  •  04/03/2026 14:30  •  "Corrigido telefone e..."     │
│       ┣ identification.telefone: (11) 99999-9999 → 98888-0000│
│       ┗ volume.tamanho_banco:    50 GB → 65 GB             │
│  v1  •  04/03/2026 09:15  •  (versão inicial)              │
└─────────────────────────────────────────────────────────────┘
```

**Funcionalidades:**
- Seletor de versão (tabs ou dropdown) para ver dados de versões anteriores
- Campos alterados em relação à versão anterior destacados (ex: fundo amarelo claro)
- Tooltip nos campos alterados mostrando o valor anterior
- Dropdown de status com ações: "Marcar em revisão", "Aprovar", "Rejeitar"
- Histórico expansível com o diff de cada versão

**API calls:**
```
GET /api/v1/public-apps/:slug/responses/:groupId           (versão atual)
GET /api/v1/public-apps/:slug/responses/:groupId/history   (todas as versões)
PATCH /api/v1/public-apps/:slug/responses/:groupId/status  (alterar status)
```

---

## 6. Renderizando o Diff (`changesFromPrevious`)

O campo `changesFromPrevious` usa dot-notation. Para exibir de forma amigável:

```typescript
// Converter dot-notation para label legível
function pathToLabel(path: string): string {
  // "identification.telefone" → "Telefone"
  // "volume.tamanho_banco"    → "Tamanho do Banco"
  const last = path.split('.').pop() ?? path;
  return last.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Componente de diff
function DiffBadge({ entry }: { entry: DiffEntry }) {
  if (entry.from === null) return <span className="badge-new">Novo: {String(entry.to)}</span>;
  if (entry.to === null)   return <span className="badge-removed">Removido: {String(entry.from)}</span>;
  return (
    <span className="badge-changed">
      <s>{String(entry.from)}</s> → {String(entry.to)}
    </span>
  );
}
```

**Highlight de campos alterados na versão atual:**

```typescript
// Verificar se um path está no diff da versão atual
function isFieldChanged(formDataPath: string, changesFromPrevious: Record<string, DiffEntry> | null): boolean {
  return changesFromPrevious !== null && formDataPath in changesFromPrevious;
}
```

---

## 7. Tratamento de Erros Comuns

| Status HTTP | Código | Causa | Como tratar no frontend |
|---|---|---|---|
| `404` | `NOT_FOUND` | App ou resposta não existe | Redirecionar para lista com mensagem |
| `409` | `CONFLICT` | Slug já cadastrado | Mostrar erro inline no campo `slug` |
| `400` | `VALIDATION_ERROR` | Campo obrigatório faltando | Mapear `error.details` para campos do form |
| `401` | `UNAUTHORIZED` | JWT expirado/ausente | Redirecionar para login |

**Formato do erro:**
```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "App with slug \"myio-migration-form-v6\" already exists"
  },
  "meta": { "requestId": "uuid" }
}
```

---

## 8. Fluxo de Status das Respostas

```
SUBMITTED
    │
    ▼
UNDER_REVIEW  ──────────────────┐
    │                           │
    ├──► APPROVED               │
    │                           │
    └──► REJECTED               │
                                │
ARCHIVED  ◄─────────────────────┘  (qualquer status pode ser arquivado)
```

**Transições recomendadas no dropdown de ações:**

| Status atual | Ações disponíveis |
|---|---|
| `SUBMITTED` | "Iniciar revisão" → `UNDER_REVIEW` |
| `UNDER_REVIEW` | "Aprovar" → `APPROVED` / "Rejeitar" → `REJECTED` |
| `APPROVED` | "Arquivar" → `ARCHIVED` |
| `REJECTED` | "Reabrir revisão" → `UNDER_REVIEW` / "Arquivar" → `ARCHIVED` |

---

## 9. Exemplo de Integração Completa

```typescript
const BASE = 'http://localhost:3015/api/v1';

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`,
  'X-Tenant-Id': tenantId,
};

// 1. Listar apps ativos
const apps = await fetch(`${BASE}/public-apps?status=ACTIVE`, { headers }).then(r => r.json());

// 2. Listar respostas de um app (última versão de cada)
const responses = await fetch(`${BASE}/public-apps/myio-migration-form-v6/responses?limit=20`, { headers }).then(r => r.json());

// 3. Ver histórico de um respondente
const history = await fetch(`${BASE}/public-apps/myio-migration-form-v6/responses/${groupId}/history`, { headers }).then(r => r.json());

// 4. Aprovar resposta
await fetch(`${BASE}/public-apps/myio-migration-form-v6/responses/${groupId}/status`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({ status: 'APPROVED' }),
});
```

---

## 10. Referências

- **RFC completo:** [`docs/RFC-0020-Public-Single-Apps.md`](./RFC-0020-Public-Single-Apps.md)
- **Swagger UI (local):** `http://localhost:3015/docs`
- **Controller:** `src/controllers/public-single-apps.controller.ts`
- **Service:** `src/services/PublicSingleAppService.ts`
- **Migration SQL:** `scripts/db/migrations/public-single-apps.sql`
