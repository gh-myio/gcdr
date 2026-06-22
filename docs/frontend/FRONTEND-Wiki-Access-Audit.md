# Wiki Access Audit — Frontend Integration Guide

- **Status:** Backend live (`GET /api/v1/wiki/access-check/:userId`).
- **Last updated:** 2026-05-04
- **Audience:** Frontend developers building the **"Wiki access audit"** screen — a diagnostic UI that explains *why* a given user can or can't write/publish wiki pages.
- **Companion docs:**
  - [FRONTEND-Wiki-Integrations-Form.md](./FRONTEND-Wiki-Integrations-Form.md) — the form that triggers `wiki.page.create` + `wiki.visibility.public`.
  - [RFC-0030 — MYIO Wiki](../rfcs/RFC-0030-MYIO-Wiki-Knowledge-Base.md) — RBAC + visibility model.
  - [GCDR-USER.md](../GCDR-USER.md) — auth, tenant header, role/policy concepts.

---

## Goal

Given a user UUID, render a screen that answers in seconds:

> *"Can this user create a wiki page? Can they publish it as PUBLIC? If not, which role/policy is missing?"*

The endpoint already returns a structured payload — the UI just needs to render it well. No client-side RBAC math is required.

---

## Endpoint contract

### Request

```
GET /api/v1/wiki/access-check/:userId
Authorization: Bearer <JWT>
X-Tenant-Id: <tenant-uuid>          # optional; default tenant if omitted
```

- `:userId` must be a valid UUID.
- The audit runs **in the caller's tenant**. If the target user lives in a different tenant, the response is `404`.

### Response 200 OK

```json
{
  "data": {
    "user": {
      "id": "7c3aed83-fae1-4fde-807a-876f2576a88d",
      "tenantId": "11111111-1111-1111-1111-111111111111",
      "email": "alice@myio.com.br",
      "type": "INTERNAL",
      "customerId": null,
      "partnerId": null,
      "status": "active",
      "createdAt": "2026-01-12T10:00:00.000Z"
    },
    "activeRoleAssignments": [
      {
        "roleKey": "role:wiki-author",
        "scope": "*",
        "status": "active",
        "expiresAt": null,
        "grantedAt": "2026-01-15T09:00:00.000Z",
        "grantedBy": "bbbb1111-1111-1111-1111-111111111111",
        "reason": "Onboarding"
      }
    ],
    "roles": [
      {
        "key": "role:wiki-author",
        "displayName": "Wiki Author",
        "riskLevel": "low",
        "policies": ["policy:wiki-author"],
        "policyCount": 1
      }
    ],
    "policies": [
      {
        "key": "policy:wiki-author",
        "displayName": "Wiki Author",
        "riskLevel": "low",
        "allowWiki": [
          "wiki.page.read",
          "wiki.page.create",
          "wiki.page.update",
          "wiki.page.publish",
          "wiki.page.archive",
          "wiki.page.move",
          "wiki.namespace.read",
          "wiki.attachment.upload",
          "wiki.attachment.read",
          "wiki.visibility.tenant-private"
        ],
        "denyWiki": []
      }
    ],
    "aggregatedWikiPermissions": {
      "allow": [
        "wiki.attachment.read",
        "wiki.attachment.upload",
        "wiki.namespace.read",
        "wiki.page.archive",
        "wiki.page.create",
        "wiki.page.move",
        "wiki.page.publish",
        "wiki.page.read",
        "wiki.page.update",
        "wiki.visibility.tenant-private"
      ],
      "deny": []
    },
    "verdict": [
      { "requiredPermission": "wiki.page.read",     "inAllow": true,  "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.page.create",   "inAllow": true,  "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.page.update",   "inAllow": true,  "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.page.publish",  "inAllow": true,  "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.page.move",     "inAllow": true,  "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.page.archive",  "inAllow": true,  "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.page.delete",   "inAllow": false, "inDeny": false, "verdict": "NOT_GRANTED" },
      { "requiredPermission": "wiki.namespace.read","inAllow": true,  "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.namespace.create","inAllow": false, "inDeny": false, "verdict": "NOT_GRANTED" },
      { "requiredPermission": "wiki.attachment.upload","inAllow": true,  "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.visibility.public","inAllow": false, "inDeny": false, "verdict": "NOT_GRANTED" },
      { "requiredPermission": "wiki.visibility.myio-internal","inAllow": false, "inDeny": false, "verdict": "NOT_GRANTED" },
      { "requiredPermission": "wiki.visibility.tenant-private","inAllow": true, "inDeny": false, "verdict": "ALLOWED" },
      { "requiredPermission": "wiki.visibility.partners","inAllow": false, "inDeny": false, "verdict": "NOT_GRANTED" },
      { "requiredPermission": "wiki.visibility.holding-customers","inAllow": false, "inDeny": false, "verdict": "NOT_GRANTED" },
      { "requiredPermission": "wiki.visibility.non-holding-customers","inAllow": false, "inDeny": false, "verdict": "NOT_GRANTED" }
    ],
    "summary": {
      "canCreatePage": true,
      "canAssignPublic": false,
      "canUseIntegrationForm": false,
      "recommendation": "PARCIAL — pode criar páginas mas será bloqueado por ForbiddenError ao tentar PUBLIC. Atribua role com policy:wiki-myio-admin (ou crie role com wiki.visibility.public)."
    },
    "evaluatedAt": "2026-05-04T17:42:00.000Z"
  },
  "meta": { "requestId": "..." }
}
```

### Field reference

#### `user`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | The audited user's UUID. |
| `tenantId` | uuid | Tenant the user lives in. Always equals the caller's tenant in this endpoint. |
| `email` | string | Display label for the avatar/header. |
| `type` | `'INTERNAL' \| 'PARTNER' \| 'CUSTOMER'` | Drives the audience resolution (MYIO_INTERNAL vs PARTNERS vs *_CUSTOMERS). |
| `customerId` | uuid \| null | Set if user belongs to a customer (which then maps to HOLDING / NON_HOLDING). |
| `partnerId` | uuid \| null | Set if user belongs to a partner. |
| `status` | string | `active` / `disabled` / `pending`. Show a badge. |
| `createdAt` | ISO date | Sortable timestamp. |

#### `activeRoleAssignments[]`

| Field | Type | Notes |
| --- | --- | --- |
| `roleKey` | string | E.g., `role:wiki-author`. Click → drill into role panel. |
| `scope` | string | `*` (global) or `customer:<uuid>` (scoped). Show as chip. |
| `status` | string | Always `active` here (the endpoint filters expired). |
| `expiresAt` | ISO date \| null | If set, show a "expira em X dias" hint. |
| `grantedAt` | ISO date | Sort default DESC. |
| `grantedBy` | uuid | Admin who granted — resolve to email via your existing user lookup. |
| `reason` | string \| null | Free-form note on why the role was granted. |

#### `roles[]`

| Field | Type | Notes |
| --- | --- | --- |
| `key` | string | Role identifier. |
| `displayName` | string | Human-readable label. |
| `riskLevel` | `'low' \| 'medium' \| 'high' \| 'critical'` | Color the row by risk: green / amber / red. |
| `policies` | string[] | Policy keys this role aggregates. |
| `policyCount` | number | Convenience for listing badges. |

#### `policies[]`

| Field | Type | Notes |
| --- | --- | --- |
| `key` | string | E.g., `policy:wiki-author`. |
| `displayName` | string | Label. |
| `riskLevel` | string | Same color scheme as `roles[]`. |
| `allowWiki` | string[] | Only `wiki.*` allow entries (already filtered server-side). |
| `denyWiki` | string[] | Only `wiki.*` deny entries — show in red. |

#### `aggregatedWikiPermissions`

Flat de-duplicated lists across **all** policies. Use this to drive the high-level "what can they do?" panel.

| Field | Type | Notes |
| --- | --- | --- |
| `allow` | string[] | Sorted ASC. |
| `deny` | string[] | Sorted ASC. Usually empty unless someone wrote an explicit deny. |

> **Important:** `*` entries in this list (e.g., `wiki.*.*`) are **patterns**, not concrete grants. Don't render them as flat permissions in user-facing chips — show the pattern with a label like *"covers everything in wiki.*"*. The `verdict` table is the safer place to express what's actually granted.

#### `verdict[]`

A row per "interesting" permission (16 today). Drives the main grid.

| Field | Type | Notes |
| --- | --- | --- |
| `requiredPermission` | string | e.g., `wiki.page.create`. |
| `inAllow` | boolean | A granted pattern matched (segment-wise with `*`). |
| `inDeny` | boolean | A deny pattern matched. |
| `verdict` | `'ALLOWED' \| 'DENIED' \| 'NOT_GRANTED'` | Render with color: green / red / gray. |

> **Verdict precedence:** `DENIED` ⟶ `ALLOWED` ⟶ `NOT_GRANTED`. A deny pattern always wins. The backend already applies that rule — don't re-derive on the FE.

#### `summary`

The bottom-line answer. This is the most prominent card on the screen.

| Field | Type | Notes |
| --- | --- | --- |
| `canCreatePage` | boolean | `wiki.page.create` is `ALLOWED`. |
| `canAssignPublic` | boolean | `wiki.visibility.public` is `ALLOWED`. |
| `canUseIntegrationForm` | boolean | `canCreatePage AND canAssignPublic`. **This is the single signal** the integrations form should gate on. |
| `recommendation` | string | Human-readable next step (`OK` / `PARCIAL` / `BLOQUEADO` + which policy to assign). Render verbatim. |

#### `evaluatedAt`

ISO timestamp. Use to show *"Verificado às 14:42"* below the page header.

---

### Errors

| Status | Code / shape | Quando ocorre | UX |
| --- | --- | --- | --- |
| `400` | Zod validation (`userId` not a UUID) | Path param malformado. | Mostrar inline: "ID inválido — esperado UUID". |
| `401` | `Unauthorized` | JWT ausente/expirado. | Redirect login. |
| `404` | `NotFoundError` (`User <id> not found in tenant <id>`) | Usuário não está no tenant da requisição (ou foi deletado). | Card vazio: "Usuário não encontrado neste tenant." Oferecer botão *"Trocar de tenant"* se UI suportar. |
| `5xx` | `InternalError` | Erro inesperado. | Toast vermelho + botão "Tentar novamente". Manter o input de userId preenchido. |

---

## Premium UX — recomendações de layout

Tela única, com **5 zonas** empilhadas verticalmente. Sem tabs, sem wizard.

### 1. Top hero (sticky)

```
┌─────────────────────────────────────────────────────────────────────┐
│ [avatar] alice@myio.com.br                              [active]    │
│          INTERNAL · created 2026-01-12 · evaluated 14:42            │
│                                                                     │
│  ▶ POST /wiki/integrations/from-form:  ⛔ BLOQUEADO                 │
│  PARCIAL — pode criar páginas mas será bloqueado por ForbiddenError │
│  ao tentar PUBLIC. Atribua role com policy:wiki-myio-admin.         │
└─────────────────────────────────────────────────────────────────────┘
```

- Verdict badge à esquerda baseado em `summary.canUseIntegrationForm`:
  - `true` → ✅ verde "OK"
  - `false` + `canCreatePage` → 🟡 amber "PARCIAL"
  - `false` + `!canCreatePage` → 🔴 vermelho "BLOQUEADO"
- Texto da `recommendation` literal embaixo.
- Botão à direita: **"Copiar recomendação"** (clipboard).

### 2. Verdict grid (a peça central)

Tabela de 16 linhas — uma por permission requerida. **Sticky header**, ordenada agrupando por categoria:

```
Permission                           |  Verdict
─────────────────────────────────────────────────
PAGE
  wiki.page.read                     |  ✅ ALLOWED
  wiki.page.create                   |  ✅ ALLOWED
  wiki.page.update                   |  ✅ ALLOWED
  wiki.page.publish                  |  ✅ ALLOWED
  wiki.page.move                     |  ✅ ALLOWED
  wiki.page.archive                  |  ✅ ALLOWED
  wiki.page.delete                   |  ⚪ NOT_GRANTED
NAMESPACE
  wiki.namespace.read                |  ✅ ALLOWED
  wiki.namespace.create              |  ⚪ NOT_GRANTED
ATTACHMENT
  wiki.attachment.upload             |  ✅ ALLOWED
VISIBILITY  ← essa coluna decide se a integração vira pública
  wiki.visibility.public             |  ⚪ NOT_GRANTED   ← chave do bloqueio
  wiki.visibility.myio-internal      |  ⚪ NOT_GRANTED
  wiki.visibility.tenant-private     |  ✅ ALLOWED
  wiki.visibility.partners           |  ⚪ NOT_GRANTED
  wiki.visibility.holding-customers  |  ⚪ NOT_GRANTED
  wiki.visibility.non-holding-customers | ⚪ NOT_GRANTED
```

- Linha clicável → expande mostrando *qual policy concedeu* (cruzar com `policies[]` no FE: encontrar policies onde `allowWiki` matches a permission).
- Filtro: "Mostrar só ALLOWED / DENIED / NOT_GRANTED" (chips).
- Highlight automático na linha `wiki.visibility.public` se `summary.canAssignPublic === false` (borda amber/vermelha).

#### Agrupamento sugerido

```ts
function groupOf(perm: string): 'PAGE' | 'NAMESPACE' | 'ATTACHMENT' | 'VISIBILITY' {
  if (perm.startsWith('wiki.page.'))       return 'PAGE';
  if (perm.startsWith('wiki.namespace.'))  return 'NAMESPACE';
  if (perm.startsWith('wiki.attachment.')) return 'ATTACHMENT';
  if (perm.startsWith('wiki.visibility.')) return 'VISIBILITY';
  return 'PAGE'; // fallback
}
```

### 3. Roles & Policies (lado a lado, 2 colunas)

```
┌─ Roles ──────────────────────┐  ┌─ Policies ───────────────────────┐
│ ◉ role:wiki-author    [low]  │  │ ◉ policy:wiki-author       [low] │
│   1 policy                   │  │   ✅ wiki.page.read              │
│   policy:wiki-author         │  │   ✅ wiki.page.create            │
│                              │  │   ✅ wiki.page.update            │
│ ◉ role:wiki-reviewer  [low]  │  │   ✅ wiki.visibility.tenant-priv.│
│   1 policy                   │  │                                  │
│   policy:wiki-reviewer       │  │ ◉ policy:wiki-reviewer     [low] │
│                              │  │   ...                            │
└──────────────────────────────┘  └──────────────────────────────────┘
```

- Roles: card por role com chips de policies (clicáveis — ao clicar, scroll até a policy correspondente).
- Policies: card por policy com lista vertical de `allowWiki` (verde) e `denyWiki` (vermelho).
- Color border do card pelo `riskLevel`: `low` cinza · `medium` amber · `high` laranja · `critical` vermelho.

### 4. Active assignments table

Tabela compacta no rodapé:

```
Role                | Scope    | Granted at         | Granted by | Expires      | Reason
────────────────────┼──────────┼────────────────────┼────────────┼──────────────┼────────────
role:wiki-author    | *        | 2026-01-15 09:00   | admin@myio | —            | Onboarding
```

- Resolver `grantedBy` (UUID) → email via `GET /users/:id` cacheado.
- Se `expiresAt` < hoje + 7 dias, badge amber "expira em 5 dias".

### 5. Footer actions

- **"Atribuir role…"** — abre modal de role assignment (sua UI existente). Pré-popula `userId`.
- **"Re-executar audit"** — refaz o `GET /wiki/access-check/:userId` (no caching client-side).
- **"Exportar JSON"** — `JSON.stringify(data, null, 2)` → download.

---

## Color tokens (sugestão)

```ts
export const VERDICT_TONES = {
  ALLOWED:     { bg: 'bg-green-50',  text: 'text-green-700',  icon: '✅' },
  DENIED:      { bg: 'bg-red-50',    text: 'text-red-700',    icon: '⛔' },
  NOT_GRANTED: { bg: 'bg-gray-50',   text: 'text-gray-500',   icon: '⚪' },
} as const;

export const RISK_TONES = {
  low:      { bg: 'bg-gray-100',   text: 'text-gray-700' },
  medium:   { bg: 'bg-amber-100',  text: 'text-amber-700' },
  high:     { bg: 'bg-orange-100', text: 'text-orange-700' },
  critical: { bg: 'bg-red-100',    text: 'text-red-700' },
} as const;
```

---

## Reference React component (esqueleto)

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Verdict = 'ALLOWED' | 'DENIED' | 'NOT_GRANTED';

interface AuditReport {
  user: {
    id: string; tenantId: string; email: string; type: string;
    customerId: string | null; partnerId: string | null;
    status: string; createdAt: string;
  };
  activeRoleAssignments: Array<{
    roleKey: string; scope: string; status: string;
    expiresAt: string | null; grantedAt: string;
    grantedBy: string; reason: string | null;
  }>;
  roles: Array<{
    key: string; displayName: string; riskLevel: string;
    policies: string[]; policyCount: number;
  }>;
  policies: Array<{
    key: string; displayName: string; riskLevel: string;
    allowWiki: string[]; denyWiki: string[];
  }>;
  aggregatedWikiPermissions: { allow: string[]; deny: string[] };
  verdict: Array<{
    requiredPermission: string; inAllow: boolean; inDeny: boolean; verdict: Verdict;
  }>;
  summary: {
    canCreatePage: boolean;
    canAssignPublic: boolean;
    canUseIntegrationForm: boolean;
    recommendation: string;
  };
  evaluatedAt: string;
}

export function WikiAccessAudit({ userId }: { userId: string }) {
  const [report, setReport]   = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_GCDR_BASE_URL}/wiki/access-check/${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${getJwt()}`,
            'X-Tenant-Id':   getTenantId(),
          },
        },
      );
      if (res.status === 404) {
        setError('Usuário não encontrado neste tenant.');
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error?.message ?? 'Erro inesperado');
        return;
      }
      const { data } = await res.json();
      setReport(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [userId]);

  if (loading)         return <Spinner label="Verificando acesso…" />;
  if (error)           return <ErrorCard message={error} onRetry={load} />;
  if (!report)         return null;

  const overall = !report.summary.canUseIntegrationForm
    ? (report.summary.canCreatePage ? 'PARTIAL' : 'BLOCKED')
    : 'OK';

  return (
    <div className="space-y-6">
      {/* 1. Top hero */}
      <HeroCard
        user={report.user}
        evaluatedAt={report.evaluatedAt}
        overall={overall}
        recommendation={report.summary.recommendation}
      />

      {/* 2. Verdict grid */}
      <VerdictGrid rows={report.verdict} />

      {/* 3. Roles & Policies */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RolesPanel roles={report.roles} />
        <PoliciesPanel policies={report.policies} />
      </div>

      {/* 4. Assignments table */}
      <AssignmentsTable rows={report.activeRoleAssignments} />

      {/* 5. Footer actions */}
      <FooterActions
        userId={userId}
        onRefresh={load}
        report={report}
      />
    </div>
  );
}
```

### `VerdictGrid` quick recipe

```tsx
function VerdictGrid({ rows }: { rows: AuditReport['verdict'] }) {
  const groups = ['PAGE', 'NAMESPACE', 'ATTACHMENT', 'VISIBILITY'] as const;
  const groupOf = (p: string) =>
    p.startsWith('wiki.page.')       ? 'PAGE'
    : p.startsWith('wiki.namespace.')  ? 'NAMESPACE'
    : p.startsWith('wiki.attachment.') ? 'ATTACHMENT'
    : 'VISIBILITY';

  return (
    <section aria-labelledby="verdict-h">
      <h2 id="verdict-h" className="text-lg font-semibold mb-3">Permissões necessárias</h2>
      {groups.map((g) => (
        <div key={g} className="mb-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">{g}</div>
          <ul className="divide-y divide-gray-100 rounded-lg border">
            {rows.filter((r) => groupOf(r.requiredPermission) === g).map((r) => (
              <li key={r.requiredPermission}
                  className="flex items-center justify-between px-4 py-2">
                <code className="text-sm">{r.requiredPermission}</code>
                <VerdictBadge value={r.verdict} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function VerdictBadge({ value }: { value: Verdict }) {
  const tone = VERDICT_TONES[value];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5
                      text-xs font-medium ${tone.bg} ${tone.text}`}>
      <span aria-hidden>{tone.icon}</span>
      {value}
    </span>
  );
}
```

---

## Cross-linking the verdict with policies

Útil para mostrar *"esta permissão veio de qual policy"* quando o usuário expande uma linha. O matching segment-wise (mesma regra do backend):

```ts
function permissionMatches(target: string, pattern: string): boolean {
  const [td, tf, ta] = target.split('.');
  const [pd, pf, pa] = pattern.split('.');
  if (pd !== '*' && pd !== td) return false;
  if (pf !== '*' && pf !== tf) return false;
  if (pa !== '*' && pa !== ta) return false;
  return true;
}

function policiesGranting(
  target: string,
  policies: AuditReport['policies'],
): Array<{ policyKey: string; via: string }> {
  const out: Array<{ policyKey: string; via: string }> = [];
  for (const p of policies) {
    for (const pattern of p.allowWiki) {
      if (permissionMatches(target, pattern)) {
        out.push({ policyKey: p.key, via: pattern });
      }
    }
  }
  return out;
}
```

Renderizar no expand:

> *"`wiki.page.create` foi concedido por `policy:wiki-author` (via padrão exato)."*
> *"`wiki.page.delete` foi concedido por `policy:wiki-myio-admin` (via padrão `wiki.*.*`)."*

---

## Pós-audit — ações que a UI pode oferecer

Quando o veredito é `PARCIAL` ou `BLOQUEADO`, oferecer atalhos:

| Veredito | Recomendação inline | CTA |
| --- | --- | --- |
| `BLOQUEADO` (sem `wiki.page.create`) | "Falta a role básica de Wiki Author." | **Atribuir `role:wiki-author`** → abre modal de role assignment com `userId` pré-preenchido. |
| `PARCIAL` (sem `wiki.visibility.public`) | "Falta permissão de publicar como público." | **Atribuir `role:wiki-myio-admin`** ou **Criar role custom** com `wiki.visibility.public`. |
| `OK` | "Tudo certo." | Botão **"Abrir formulário de integração"** → navega pra `/wiki/integrations/new`. |

---

## Acceptance checklist

- [ ] Loading state com spinner antes do fetch.
- [ ] `404` mostra empty state com mensagem clara, sem quebrar a UI.
- [ ] `summary.recommendation` aparece literal (não reescrito) no hero.
- [ ] Badge global colorido (verde/amber/vermelho) baseado em `canUseIntegrationForm` + `canCreatePage`.
- [ ] Verdict grid agrupa por PAGE / NAMESPACE / ATTACHMENT / VISIBILITY.
- [ ] Linha `wiki.visibility.public` recebe destaque visual quando `verdict !== 'ALLOWED'`.
- [ ] Cards de role/policy com border-color baseada em `riskLevel`.
- [ ] `expiresAt` próximo (≤ 7 dias) destacado com badge amber.
- [ ] Click numa policy faz scroll até o card correspondente.
- [ ] Botão "Re-executar audit" refaz o fetch (sem cache stale).
- [ ] Botão "Exportar JSON" baixa o payload completo.
- [ ] Acessibilidade: cada section tem `aria-labelledby`, badges com texto (não só ícone).
- [ ] Mobile: cards empilham single-column, verdict grid vira lista scrollável horizontal.

---

## Observações de segurança

- O endpoint atualmente exige apenas autenticação (`authMiddleware`) — qualquer usuário logado consegue auditar qualquer outro user **dentro do mesmo tenant**.
- Se a UI for exposta a usuários não-admins, considere esconder a tela atrás de um link só visível para roles administrativas. Backend não bloqueia hoje.
- Se essa preocupação for relevante, peça ao backend para gating em `auth.role-assignment.read` — o suficiente é trocar uma chamada de `evaluatePermission` no controller.

---

## Próximos passos (opcional, backend)

- **Self-audit endpoint** — `GET /wiki/access-check/me` (mesma resposta, sem path param) para o user logado se auto-auditar.
- **Diff entre dois usuários** — `GET /wiki/access-check/diff?a=<uuid>&b=<uuid>` para comparar dois users lado a lado.
- **Bulk audit** — `POST /wiki/access-check/bulk { userIds: [...] }` para listar quem do time tem PUBLIC publishing.
