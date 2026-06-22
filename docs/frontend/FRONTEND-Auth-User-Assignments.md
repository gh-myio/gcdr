# Auth — Listar Role Assignments de um Usuário (FE)

- **Status:** Backend live.
- **Last updated:** 2026-05-07
- **Audience:** Frontend que precisa mostrar/inspecionar as role assignments de um usuário específico (telas de admin de RBAC, perfil, gating de UI por permissão).
- **Companion docs:**
  - [GCDR-USER.md](../GCDR-USER.md) — auth (JWT + API Key), tenant header, ciclo de usuário.
  - [FRONTEND-Users-Groups-Roles.md](./FRONTEND-Users-Groups-Roles.md) — fluxo completo de RBAC.
  - **OpenAPI:** Swagger UI em `/docs` (local + prod).

---

## TL;DR

**Não use** `GET /authorization/assignments?userId=<id>`. Esse endpoint **ignora silenciosamente** o filtro `?userId=` e devolve a lista paginada de **todas** as assignments do tenant — fácil de confundir com "o usuário tem 3 roles" quando na verdade o usuário tem zero.

**Use** `GET /authorization/users/:userId/assignments`. O `userId` vai no path, a resposta é só do usuário pedido.

---

## Problema que motivou este guia

Frontend chamou:

```http
GET /api/v1/authorization/assignments?userId=fee5f663-743a-4308-9212-4d43826403bb&page=1&pageSize=100
```

Esperava receber as assignments do usuário `fee5f663...` (que **não tem nenhuma role**). Em vez disso, recebeu 3 itens — todos de **outros usuários** do tenant — porque a rota global não implementa o filtro `?userId=`. O FE então mostrou comportamento inconsistente com `/auth/me` (que devolve `assignments: []` corretamente).

Isso vai ser endurecido no BE em momento futuro (rejeitar query params não suportados com 400). Enquanto isso, **mudar o endpoint** já resolve.

---

## Endpoint correto

### Request

```http
GET /api/v1/authorization/users/:userId/assignments
Authorization: Bearer <jwt>
```

Sem query params. O `userId` é parâmetro de path.

**Auth — duas opções (escolha uma):**

| Modo            | Header                                               | Quando usar                                            |
|-----------------|------------------------------------------------------|--------------------------------------------------------|
| JWT do usuário  | `Authorization: Bearer <jwt>`                        | Tela navegada por humano logado (admin inspecionando). |
| Master API Key  | `X-API-Key: <GCDR_MASTER_API_KEY>` + `X-Tenant-Id`   | Backend para backend / tooling administrativo.         |

### Response — usuário sem nenhuma role (caso comum em self-registered)

```json
{
  "success": true,
  "data": {
    "userId": "fee5f663-743a-4308-9212-4d43826403bb",
    "assignments": []
  },
  "meta": {
    "requestId": "...",
    "timestamp": "2026-05-07T14:22:28.923Z"
  }
}
```

### Response — usuário com role(s) atribuída(s)

```json
{
  "success": true,
  "data": {
    "userId": "bbbb1111-1111-1111-1111-111111111111",
    "assignments": [
      {
        "id":         "eeee1111-1111-1111-1111-111111111111",
        "tenantId":   "11111111-1111-1111-1111-111111111111",
        "userId":     "bbbb1111-1111-1111-1111-111111111111",
        "roleKey":    "role:super-admin",
        "scope":      "*",
        "status":     "active",
        "grantedBy":  "bbbb1111-1111-1111-1111-111111111111",
        "grantedAt":  "2025-11-22T07:33:39.593Z",
        "reason":     "Initial system administrator setup",
        "expiresAt":  null,
        "version":    1,
        "createdAt":  "2026-02-20T07:33:39.593Z",
        "updatedAt":  "2026-02-20T07:33:39.593Z"
      }
    ]
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

### Diferenças importantes em relação a `/authorization/assignments`

| Aspecto             | `GET /assignments` (global)                       | `GET /users/:userId/assignments` (per-user)         |
|---------------------|---------------------------------------------------|-----------------------------------------------------|
| Escopo              | Todas as assignments do tenant inteiro            | Só do `:userId` informado                           |
| Filtros             | `limit`, `cursor` (paginação)                     | Nenhum                                              |
| Status filtrado     | Não filtra — vem `active` + `inactive` + `expired`| **Só `status='active'`** (silenciosamente)          |
| Forma da resposta   | `data.items[]` + `data.pagination`                | `data.assignments[]` (sem pagination)               |
| Roles enriquecidas? | Não — só campos crus da assignment                | Não — só campos crus da assignment                  |

**Ponto-chave:** este endpoint **só retorna assignments ativas**. Se você precisa enxergar histórico (assignments revogadas/expiradas), volta pra rota global e ela vem com tudo — porém aí a ausência do filtro `?userId=` te obriga a paginar e filtrar no FE até aparecer um endpoint dedicado, OU usar `?userId=` quando o BE for endurecido.

---

## Quando usar cada endpoint

| Você quer mostrar...                                                | Use                                                           |
|---------------------------------------------------------------------|---------------------------------------------------------------|
| Assignments do **usuário logado** (gating da UI dele mesmo)         | `GET /auth/me` — já traz `assignments` e `effectivePermissions` |
| Assignments crus de **outro** usuário (admin inspecionando)         | `GET /authorization/users/:userId/assignments` ← **este guia** |
| Roles + policies expandidas + permissions efetivas + denies         | `GET /authorization/users/:userId/permissions`                |
| Lista geral de todas assignments do tenant (admin de RBAC)          | `GET /authorization/assignments` (paginada)                   |

Pra **gating de tela** (mostrar/esconder botão "Criar página", "Editar usuário", etc.) **prefira `effectivePermissions`** (`/auth/me` para o próprio user, `/authorization/users/:userId/permissions` para outros). A lista crua de assignments te mostra "que role o usuário tem", não "que permissão a UI deve liberar".

---

## Estado de permissões — exemplo enriquecido

Para a tela de wiki que mostra "você pode/não pode criar página", `/auth/me` é o caminho correto:

```http
GET /api/v1/auth/me
Authorization: Bearer <jwt>
```

```json
{
  "success": true,
  "data": {
    "user": { /* ... perfil ... */ },
    "assignments": [],
    "effectivePermissions": [],
    "deniedPatterns": []
  }
}
```

Permissions usam o formato `domain.function.action`. **Wildcards `*` valem por segmento** — por exemplo `wiki.*.*` cobre `wiki.page.create`, `wiki.page.update`, etc. Existe também um wildcard "puro" legado (`*` sozinho) que cobre tudo, herdado de payloads antigos.

O FE precisa aplicar **três regras nessa ordem** (espelhando `AuthorizationService.permissionMatches` no backend):

1. **Deny vence sempre.** Se algum pattern de `deniedPatterns` casar com a permissão pedida, nega — inclusive pra super-admin.
2. **Super-admin fast-path.** Usuário com `user.role === 'ADMIN'`, ou com assignment ativa de `role:super-admin`/`role:admin`, recebe `true` mesmo que `effectivePermissions` venha vazio. O BE **não materializa** `effectivePermissions` pra super-admin (ele bypassa via role-key); se o FE só olhasse a lista resolvida, gateava o admin pra fora de todas as features.
3. **Match segment-wise** contra `effectivePermissions`. Comprimentos diferentes não casam (`wiki.page` ≠ `wiki.page.create`); cada segmento precisa bater por igualdade ou ser `*`.

```ts
function permissionMatches(permission: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern === '*') return true;          // legacy bare wildcard
  if (pattern === permission) return true;
  const t = permission.split('.');
  const p = pattern.split('.');
  if (t.length !== p.length) return false;
  return p.every((seg, i) => seg === '*' || seg === t[i]);
}

const SUPER_ADMIN_ROLE_SLUGS = new Set(['role:super-admin', 'role:admin']);

function isSuperAdmin(
  user: AuthUser | null,
  assignments: EnrichedAssignment[],
): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if ((user.roles ?? []).some((r) => SUPER_ADMIN_ROLE_SLUGS.has(r))) return true;
  // /auth/me não devolve `role` no objeto user — o role-key vive nas assignments.
  return assignments.some(
    (a) => a.status === 'active' && SUPER_ADMIN_ROLE_SLUGS.has(a.role?.key),
  );
}

function can(
  target: string,
  user: AuthUser | null,
  assignments: EnrichedAssignment[],
  allow: string[],
  deny: string[],
): boolean {
  if (!user) return false;
  // 1) Deny vence — vale inclusive pra super-admin.
  if (deny.some((p) => permissionMatches(target, p))) return false;
  // 2) Super-admin: BE não materializa effectivePermissions; assumir grant.
  if (isSuperAdmin(user, assignments)) return true;
  // 3) Match segment-wise contra a lista resolvida.
  return allow.some((p) => permissionMatches(target, p));
}

// Exemplo: pode criar página de wiki?
const ok = can('wiki.page.create', user, assignments, effectivePermissions, deniedPatterns);
```

`effectivePermissions: []` significa zero permissão **pra usuários comuns** — `can(...)` retorna `false`. É o caso do usuário self-registered antes de receber qualquer role. Pra super-admin, porém, a lista vem vazia também: o fast-path do passo 2 é o que evita gatear o admin fora das features.

---

## Migração de código (sugestão)

**Antes:**
```ts
// ❌ silencioso — userId é ignorado, traz lista do tenant inteiro
const r = await fetch(`/api/v1/authorization/assignments?userId=${userId}&pageSize=100`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
const { items } = (await r.json()).data;
```

**Depois:**
```ts
// ✅ filtrado pelo userId no path
const r = await fetch(`/api/v1/authorization/users/${userId}/assignments`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
const { assignments } = (await r.json()).data;
```

Atenção: nome do campo muda — `data.items` → `data.assignments`.

---

## Erros comuns

| Sintoma                                                                       | Causa provável                                                              |
|-------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| 401 `"Token de acesso não fornecido"`                                         | Sem header `Authorization: Bearer ...` (essa rota é JWT-only).               |
| 403 `"Acesso negado"`                                                         | Caller tem JWT mas sem permissão pra ler authorization de outros usuários.   |
| 404 `"User not found"`                                                        | `:userId` não existe no tenant atual.                                        |
| `assignments: []` no usuário admin que **deveria** ter role                   | A rota só retorna `status='active'`. Verifica se a assignment não foi revogada/expirada — nesse caso usa a rota global ou consulta o BE. |
| `/auth/me` mostra perms diferente de `/users/:userId/assignments`             | Esperado em parte. `/auth/me` traz `effectivePermissions` derivada (allows ∪ patterns). `/assignments` traz só os roleKeys crus. Para gating use `effectivePermissions`. |

---

## Checklist de migração

- [ ] Substituir `GET /authorization/assignments?userId=...` por `GET /authorization/users/:userId/assignments`.
- [ ] Atualizar reader pra `data.assignments` (era `data.items`).
- [ ] Trocar gating de UI (botões, telas) pra usar `effectivePermissions` de `/auth/me` em vez de inspecionar role keys manualmente.
- [ ] Implementar `permissionMatches` segment-wise com suporte a `*` puro e diferença de tamanho de segmentos (snippet acima).
- [ ] Aplicar **deny-wins** antes de qualquer outro check (vale até pra super-admin).
- [ ] Adicionar fast-path de **super-admin** (`user.role === 'ADMIN'` ou assignment ativa em `role:super-admin`/`role:admin`) — sem ele, super-admin é gateado fora porque o BE não materializa `effectivePermissions` pra esse caso.
- [ ] Remover assumpções de paginação onde não couber — esse endpoint não tem `pagination`.
