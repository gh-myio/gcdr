# Wiki Integrations Form — Frontend Integration Guide

- **Status:** Backend live (`POST /api/v1/wiki/integrations/from-form`).
- **Last updated:** 2026-05-04
- **Audience:** Frontend developers building the **"Add Internal Integration"** form (premium UX, single-screen wizard).
- **Companion docs:**
  - [RFC-0030 — MYIO Wiki](./RFC-0030-MYIO-Wiki-Knowledge-Base.md)
  - [GCDR-USER.md](./GCDR-USER.md) — auth, RBAC, tenant header
  - **OpenAPI:** `/api/v1/docs` (Swagger UI, prod: `https://gcdr-api.a.myio-bas.com/docs/`)

---

## Goal

Provide an internal user with a **premium, single-screen form** that captures everything we need to map an external SaaS / internal app the company uses (Lovable, Omie, Freshdesk, etc.) and creates a published Wiki page in the `Integrations` namespace with **public visibility**.

The output is a Markdown wiki page browsable at:

```
/wiki/p/Integrations/<slug>          (authenticated)
/public/wiki/p/Integrations/<slug>   (anonymous, PUBLIC)
```

---

## Endpoint contract

### Request

```
POST /api/v1/wiki/integrations/from-form
Authorization: Bearer <JWT>
X-Tenant-Id: <tenant-uuid>           # optional; default tenant if omitted
Content-Type: application/json
```

```json
{
  "name":         "Lovable App Propostas",
  "description":  "App interno construído na Lovable com Supabase para gerar propostas comerciais padronizadas.",
  "motivation":   "Substituir montagem manual em planilhas e padronizar catálogo.",
  "category":     "App Interno",
  "url":          "https://propostas.myio.com.br",
  "loginInfo":    "Supabase Auth (e-mail @myio + senha)",

  "api": {
    "docsUrl":   "https://supabase.com/docs",
    "auth":      "Supabase JWT (anon + service role)",
    "endpoints": "/rest/v1/proposals, /rest/v1/customers",
    "webhooks":  "—"
  },

  "cost": {
    "value":    "USD 25/mês",
    "currency": "USD",
    "model":    "subscription"
  },
  "plan": "Pro",

  "limits": {
    "seats":            5,
    "requestsPerMonth": "ilimitado",
    "storage":          "100 GB",
    "other":            "—"
  },

  "owner": {
    "responsible": "comercial@myio",
    "backup":      "engineering@myio"
  },

  "status": "ATIVO",

  "dates": {
    "contractedAt":   "2026-01-15",
    "renewalAt":      "2027-01-15",
    "discontinuedAt": ""
  },

  "gcdrIntegration": "Avaliar leitura de customers via API key parceiro.",
  "notes":           "Lovable exporta o código React+Tailwind — portável.",

  "tags": ["lovable", "supabase"],
  "slug": "lovable-app-propostas"
}
```

### Field reference

| Field | Type | Required | Constraints | UX hint |
| --- | --- | --- | --- | --- |
| `name` | string | ✅ | 2–120 chars | Single-line input. Used as page title. |
| `description` | string | ✅ | 1–2000 chars | Multi-line, ~3 rows. Free-form. |
| `motivation` | string | ❌ | ≤ 2000 chars | "Por que escolhemos / qual problema resolve" |
| `category` | string | ❌ | ≤ 80 chars | Select com opções pré-definidas (ver abaixo) |
| `url` | string | ❌ | URL válida, ≤ 500 | Validar com `new URL()` antes de submeter |
| `loginInfo` | string | ❌ | ≤ 500 | "SSO Google", "e-mail+senha", "link mágico" |
| `api.docsUrl` | string | ❌ | URL válida, ≤ 500 | Link para a doc oficial |
| `api.auth` | string | ❌ | ≤ 120 | "API Key", "OAuth2", "Bearer JWT" |
| `api.endpoints` | string | ❌ | ≤ 2000 | Multi-line, formato livre |
| `api.webhooks` | string | ❌ | ≤ 2000 | Multi-line, formato livre |
| `cost.value` | string | ❌ | ≤ 120 | Free-form: `"R$ 1500/mês"`, `"USD 99/seat"` |
| `cost.currency` | string | ❌ | ≤ 8 | Select: `BRL`, `USD`, `EUR`, etc. |
| `cost.model` | string | ❌ | ≤ 120 | Select: `subscription`, `usage`, `flat`, `freemium` |
| `plan` | string | ❌ | ≤ 120 | Free-form: "Pro", "Business", "Enterprise" |
| `limits.seats` | number | ❌ | int ≥ 0 | `<input type="number" min="0">` |
| `limits.requestsPerMonth` | string | ❌ | ≤ 120 | "ilimitado", "10000", "1M" |
| `limits.storage` | string | ❌ | ≤ 120 | "100 GB", "1 TB" |
| `limits.other` | string | ❌ | ≤ 500 | Free-form |
| `owner.responsible` | string | ❌ | ≤ 120 | E-mail ou squad |
| `owner.backup` | string | ❌ | ≤ 120 | Backup admin |
| `status` | enum | ❌ | `ATIVO` \| `AVALIACAO` \| `DESCONTINUADO` | Default `ATIVO`. Radio group ou Select. |
| `dates.contractedAt` | string | ❌ | ≤ 40 | Date picker → ISO `YYYY-MM-DD` |
| `dates.renewalAt` | string | ❌ | ≤ 40 | Date picker → ISO `YYYY-MM-DD` |
| `dates.discontinuedAt` | string | ❌ | ≤ 40 | Mostrar só se status = `DESCONTINUADO` |
| `gcdrIntegration` | string | ❌ | ≤ 2000 | Multi-line. "Como conversa com o GCDR?" |
| `notes` | string | ❌ | ≤ 4000 | Multi-line, observações livres |
| `tags` | string[] | ❌ | ≤ 20 itens, cada ≤ 32 chars | Tag input (chips). `integrations` é adicionado automaticamente. |
| `slug` | string | ❌ | regex `^[a-z0-9][a-z0-9/_-]{0,127}$` | Se vazio, backend slug-ifica `name`. Mostrar preview. |

#### Sugestões para o select de `category`

```ts
const CATEGORIES = [
  'ERP',
  'CRM',
  'Helpdesk',
  'App Interno',
  'Field Service',
  'Comunicação',
  'Automação / iPaaS',
  'BI / Analytics',
  'Observabilidade',
  'Identity / SSO',
  'Storage / Cloud',
  'Outro',
] as const;
```

### Response 201 Created

```json
{
  "data": {
    "id": "9f3e8a72-...",
    "tenantId": "11111111-...",
    "namespace": "Integrations",
    "slug": "lovable-app-propostas",
    "title": "Lovable App Propostas",
    "status": "PUBLISHED",
    "currentRevisionId": "abc...",
    "tags": ["integrations", "app-interno", "lovable", "supabase"],
    "visibility": ["PUBLIC"],
    "frontmatter": {
      "source": "integration-form",
      "owner": "comercial@myio",
      "category": "App Interno",
      "status": "ATIVO",
      "url": "https://propostas.myio.com.br"
    },
    "createdBy": "...",
    "createdAt": "2026-05-04T17:30:00.000Z",
    "updatedAt": "2026-05-04T17:30:00.000Z",
    "deletedAt": null,
    "version": 1,
    "currentRevision": {
      "id": "abc...",
      "pageId": "9f3e8a72-...",
      "revisionNumber": 1,
      "title": "Lovable App Propostas",
      "body": "# Lovable App Propostas\n\n## Descrição\n\n...",
      "bodyHtml": "<pre class=\"wiki-body-placeholder\">...</pre>",
      "frontmatter": {},
      "changeNote": "Created via POST /wiki/integrations/from-form",
      "authorId": "...",
      "createdAt": "2026-05-04T17:30:00.000Z"
    }
  },
  "meta": { "requestId": "..." }
}
```

### Errors

| Status | Code / shape | Quando ocorre | UX |
| --- | --- | --- | --- |
| `400` | Zod `ValidationError` (`details[]` por campo) | Campo inválido (ex.: URL malformada, slug fora da regex). | Marcar o campo em vermelho com a mensagem do `details[].path`. |
| `401` | `Unauthorized` | JWT ausente/expirado. | Redirecionar para login. |
| `403` | `ForbiddenError` (`You are not allowed to assign visibility tag(s): PUBLIC`) | Usuário não tem permissão `wiki.visibility.public`. | Mostrar banner: "Sua conta não pode publicar integrações como públicas — fale com um admin." |
| `409` | `ConflictError` (`already exists`) | Já existe uma página `Integrations/<slug>`. | Sugerir suffixar: `lovable-app-propostas-2`. Ou: oferecer "Editar página existente". |
| `5xx` | `InternalError` | Erro inesperado. | Toast de erro + manter formulário preenchido. |

---

## Premium UX — recomendações de layout

A intenção é uma experiência **single-page, rica, com visual hierarchy clara** — não wizard multi-step. A página inteira fica visível para o usuário, dividida em 6 cards/sections.

### 1. Top hero

```
┌──────────────────────────────────────────────────────────────┐
│ [icon]  Adicionar Integração                                 │
│         Mapeie uma ferramenta SaaS, app interno ou           │
│         integração externa usada pela MYIO.                  │
│                                                              │
│         [Public] esta integração ficará pública em /wiki     │
└──────────────────────────────────────────────────────────────┘
```

- Badge `Public` informando explicitamente o que vai acontecer (visibility lock-in).
- Botão "Cancelar" no canto superior direito.

### 2. Form sections (cards empilhados)

Cada card tem título + 1-linha descritiva + grupo de campos.

| # | Card | Campos | Notas |
| --- | --- | --- | --- |
| 1 | **Identificação** | `name`, `category`, `url`, `slug` (auto-preview) | Mostrar slug abaixo do `name` em tempo real, em monospace. |
| 2 | **Contexto** | `description`, `motivation` | Textareas grandes (5-6 linhas). |
| 3 | **API & Acesso** | `loginInfo`, `api.*` | Sub-grid 2x2. |
| 4 | **Comercial** | `cost.value`, `cost.currency`, `cost.model`, `plan`, `dates.*` | `discontinuedAt` aparece só se status `DESCONTINUADO`. |
| 5 | **Capacidade** | `limits.*`, `owner.*`, `status` | Status: 3 botões grandes (radio cards). |
| 6 | **Observações** | `gcdrIntegration`, `notes`, `tags` | Tag input com chips. |

### 3. Sticky footer

```
┌──────────────────────────────────────────────────────────────┐
│ * Campos obrigatórios:  nome, descrição                      │
│                                                              │
│  [ Cancelar ]      [ Pré-visualizar ]      [ Salvar — Publicar ] │
└──────────────────────────────────────────────────────────────┘
```

- **Pré-visualizar** abre modal com o Markdown rendered (chamada client-side, sem hit no backend) — *opcional, mas adiciona muito polish*.
- **Salvar** dispara `POST` direto.
- Botão Salvar fica desabilitado enquanto `name` ou `description` vazios; mostrar loading spinner durante submit.

### 4. Visual treatment

- **Tipografia:** títulos de card em `text-lg font-semibold`, helpers em `text-sm text-gray-500`.
- **Espaçamento:** `gap-6` entre cards, `gap-4` entre campos dentro de cada card.
- **Inputs:** padded, com `focus:ring-2`. Radio cards (status) ocupando largura total dividida em 3.
- **Validação:** inline, abaixo do campo, em vermelho — não esperar submit.
- **Slug preview:** abaixo do `name`, em monospace, com edit-icon ao lado para tornar editável manualmente.

---

## Slug auto-generation (espelhar no FE)

Para que o usuário **veja** o slug em tempo real, replicar a lógica do backend:

```ts
function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
  return base.length === 0 ? 'integration' : base;
}

// "Lovable App Propostas!" → "lovable-app-propostas"
// "Omie ERP — Brasil"      → "omie-erp-brasil"
```

Validar contra a regex antes de submeter:

```ts
const SLUG_RE = /^[a-z0-9][a-z0-9/_-]{0,127}$/;
```

---

## Reference React component (esqueleto)

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

const STATUSES = ['ATIVO', 'AVALIACAO', 'DESCONTINUADO'] as const;
const CATEGORIES = [
  'ERP', 'CRM', 'Helpdesk', 'App Interno', 'Field Service',
  'Comunicação', 'Automação / iPaaS', 'BI / Analytics',
  'Observabilidade', 'Identity / SSO', 'Storage / Cloud', 'Outro',
] as const;

const FormSchema = z.object({
  name:        z.string().min(2).max(120),
  description: z.string().min(1).max(2000),
  motivation:  z.string().max(2000).optional(),
  category:    z.string().max(80).optional(),
  url:         z.string().url().max(500).optional().or(z.literal('')),
  loginInfo:   z.string().max(500).optional(),
  api: z.object({
    docsUrl:   z.string().url().max(500).optional().or(z.literal('')),
    auth:      z.string().max(120).optional(),
    endpoints: z.string().max(2000).optional(),
    webhooks:  z.string().max(2000).optional(),
  }).optional(),
  cost: z.object({
    value:    z.string().max(120).optional(),
    currency: z.string().max(8).optional(),
    model:    z.string().max(120).optional(),
  }).optional(),
  plan: z.string().max(120).optional(),
  limits: z.object({
    seats:            z.coerce.number().int().nonnegative().optional(),
    requestsPerMonth: z.string().max(120).optional(),
    storage:          z.string().max(120).optional(),
    other:            z.string().max(500).optional(),
  }).optional(),
  owner: z.object({
    responsible: z.string().max(120).optional(),
    backup:      z.string().max(120).optional(),
  }).optional(),
  status: z.enum(STATUSES).default('ATIVO'),
  dates: z.object({
    contractedAt:   z.string().max(40).optional(),
    renewalAt:      z.string().max(40).optional(),
    discontinuedAt: z.string().max(40).optional(),
  }).optional(),
  gcdrIntegration: z.string().max(2000).optional(),
  notes:           z.string().max(4000).optional(),
  tags:            z.array(z.string().min(1).max(32)).max(20).default([]),
  slug:            z.string().regex(/^[a-z0-9][a-z0-9/_-]{0,127}$/).optional(),
});

type FormValues = z.infer<typeof FormSchema>;

export function IntegrationFormPremium() {
  const router = useRouter();
  const [values, setValues] = useState<Partial<FormValues>>({ status: 'ATIVO' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const slugPreview = slugify(values.slug || values.name || '');

  async function onSubmit() {
    setErrors({});
    const parsed = FormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const err of parsed.error.issues) {
        fieldErrors[err.path.join('.')] = err.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_GCDR_BASE_URL}/wiki/integrations/from-form`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getJwt()}`,
            'X-Tenant-Id':   getTenantId(),
            'Content-Type':  'application/json',
          },
          body: JSON.stringify(parsed.data),
        },
      );

      if (res.status === 201) {
        const { data } = await res.json();
        router.push(`/wiki/p/Integrations/${data.slug}`);
        return;
      }

      const err = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setErrors({ slug: 'Já existe uma integração com esse slug.' });
        return;
      }
      if (res.status === 403) {
        setErrors({ _form: 'Sua conta não pode publicar como pública — fale com um admin.' });
        return;
      }
      setErrors({ _form: err?.error?.message ?? 'Erro inesperado. Tente novamente.' });
    } finally {
      setSubmitting(false);
    }
  }

  // ... render cards (Identificação, Contexto, API & Acesso, Comercial,
  //     Capacidade, Observações) and a sticky footer with [Cancelar],
  //     [Pré-visualizar], [Salvar — Publicar].
}
```

---

## Markdown preview (opcional)

Para o botão **Pré-visualizar**, o backend já gera o Markdown — mas você pode espelhar a lógica no FE para preview imediato sem round-trip:

```ts
function buildPreview(v: FormValues): string {
  const todo = '_TODO_';
  const get = (x?: string | number | null) =>
    x === undefined || x === null || x === '' ? todo : String(x);

  return [
    `# ${v.name}`,
    '',
    '## Descrição', '', v.description, '',
    '## Motivação', '', get(v.motivation), '',
    '## Categoria', '', get(v.category), '',
    '## URL / Acesso', '',
    `- **URL principal:** ${get(v.url)}`,
    `- **Login / Acesso:** ${get(v.loginInfo)}`,
    '',
    '## API / Webhooks', '',
    `- **Docs:** ${get(v.api?.docsUrl)}`,
    `- **Auth:** ${get(v.api?.auth)}`,
    `- **Endpoints relevantes:** ${get(v.api?.endpoints)}`,
    `- **Webhooks:** ${get(v.api?.webhooks)}`,
    '',
    '## Custo', '',
    `- **Valor:** ${get(v.cost?.value)}`,
    `- **Moeda:** ${get(v.cost?.currency)}`,
    `- **Modelo de cobrança:** ${get(v.cost?.model)}`,
    '',
    '## Plano atual', '', get(v.plan), '',
    '## Usuários suportados / Limites', '',
    `- **Seats:** ${get(v.limits?.seats)}`,
    `- **Requests/mês:** ${get(v.limits?.requestsPerMonth)}`,
    `- **Storage:** ${get(v.limits?.storage)}`,
    `- **Outros limites:** ${get(v.limits?.other)}`,
    '',
    '## Owner interno', '',
    `- **Responsável:** ${get(v.owner?.responsible)}`,
    `- **Backup:** ${get(v.owner?.backup)}`,
    '',
    '## Status', '', `\`${v.status ?? 'ATIVO'}\``, '',
    '## Datas', '',
    `- **Contratação:** ${get(v.dates?.contractedAt)}`,
    `- **Renovação:** ${get(v.dates?.renewalAt)}`,
    `- **Encerramento:** ${get(v.dates?.discontinuedAt)}`,
    '',
    '## Integração com GCDR', '', get(v.gcdrIntegration), '',
    '## Notas / Observações', '', get(v.notes), '',
  ].join('\n');
}
```

Renderizar com `react-markdown` (já é comum no app) dentro de um modal lateral.

---

## Pós-criação — onde a página aparece

A página criada pelo formulário fica imediatamente visível em:

| Endpoint | Auth | Quando usar |
| --- | --- | --- |
| `GET /api/v1/wiki/pages/by-slug/Integrations/<slug>` | Bearer JWT | Logado, mesma tela do wiki interno. |
| `GET /api/v1/public/wiki/pages/by-slug/Integrations/<slug>` | nenhum | Compartilhar com parceiros / clientes. |
| `GET /api/v1/wiki/pages?namespace=Integrations` | Bearer JWT | Listagem do inventário. |
| `GET /api/v1/public/wiki/pages?namespace=Integrations` | nenhum | Listagem pública (catálogo). |

> **Listagem em UI:** após o `POST` de sucesso, fazer `router.push('/wiki/p/Integrations/<slug>')` ou redirect para `/wiki/Integrations` (lista). Mostrar toast de sucesso: *"Integração publicada — agora visível em /wiki/Integrations"*.

---

## Acceptance checklist

Antes de marcar como pronto:

- [ ] Submit com payload mínimo (`name` + `description`) → `201` e redirect.
- [ ] Submit com URL malformada → erro inline no campo `url` (sem chamada ao backend).
- [ ] Submit com slug duplicado → erro `409` tratado, mensagem amigável no campo `slug`.
- [ ] Usuário sem permissão `PUBLIC` → erro `403` tratado, banner explicativo.
- [ ] Status `DESCONTINUADO` revela campo `dates.discontinuedAt`.
- [ ] Slug preview atualiza em tempo real conforme o usuário digita o `name`.
- [ ] Botão Salvar fica desabilitado durante o request (loading spinner).
- [ ] Tag chip input aceita até 20 tags, com remove-on-click.
- [ ] Pré-visualização (se implementada) mostra o Markdown final, não o JSON.
- [ ] Acessibilidade: cada card é uma `<section>` com `aria-labelledby`, todos os inputs com `<label>`.
- [ ] Mobile: cards empilham, footer vira fixo no rodapé com 2 botões (sem "Pré-visualizar" no mobile).

---

## Próximos passos (backend)

Estas extensões já estão pré-pensadas — abrir RFC se a UI quiser:

- **Edit form** — `PUT /api/v1/wiki/pages/:id` aceita o mesmo Markdown gerado; basta reaproveitar o builder.
- **Bulk import** — endpoint `POST /api/v1/wiki/integrations/from-form/bulk` para importar via CSV/JSON.
- **Linked pages** — extrair `@customer:<uuid>` do `notes` e popular backlinks (já suportado por `WikiPageLinkRepository`).
- **Custom fields** — `frontmatter` é um `jsonb` aberto; novos campos podem ser adicionados sem migration.
