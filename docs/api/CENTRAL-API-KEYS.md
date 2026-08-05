# Central API Keys — guia de provisionamento e gestão

> Público-alvo: time de **firmware da central (Orange Pi)**, a **ferramenta de
> pre-setup** e operações que provisionam centrais no GCDR.
>
> **Status:** baseado no **RFC-0056** (`docs/rfcs/RFC-0056-Central-Initial-API-Key-Bootstrap.md`,
> draft v4). **Ainda não implementado** — este guia descreve o contrato-alvo. Os
> endpoints marcados como *novo* / *re-gate* ainda não existem no GCDR.

---

## 1. As três chaves (escada de privilégio)

O provisionamento de uma central usa três chaves, cada uma com o mínimo de poder
que precisa. Nenhum degrau alcança o de cima.

| Chave | Onde vive | Serve para | Scopes |
|---|---|---|---|
| `CENTRAL_PRE_INITIAL_API_KEY` | **hardcoded** no firmware (igual em todas as centrais) + **env var** no GCDR | só chamar o bootstrap e buscar a INITIAL | — (nenhum; validada por middleware) |
| `CENTRAL_INITIAL_API_KEY` | mint pelo GCDR (per-central), entregue à central | autenticar os endpoints **locais** da central (`GET /state`, `POST /provision`) | `central-state:read`, `central-environment:read`, `central-environment:write` |
| `CENTRAL_API_KEY` | mint pelo GCDR (operador), gravada no `environment` **local** da central | operações completas no GCDR (devices / sync / clear-data …) | `central-state:read`, `central-environment:read`, `central-environment:write`, `devices:read`, `devices:write`, `central-data:write`, `central-sync:write` |

As duas chaves per-central (`CENTRAL_INITIAL_API_KEY` e `CENTRAL_API_KEY`) são
`gcdr_cust_*` do **customer MYIO** (`56614a70-326f-11ef-ad2c-53aeabe7d3fa`),
revogáveis individualmente e vinculadas a uma central.

---

## 2. Bootstrap — obter a `CENTRAL_INITIAL_API_KEY`  *(GCDR)*

**Autenticação**: a pre-key hardcoded, no header `X-Central-Pre-Key`. Não é
JWT, não é customer key com scope — é um segredo bootstrap validado por
middleware dedicado (`centralPreKeyAuth`).

```
GET /api/v1/public/central/initial-key
X-Central-Pre-Key: <CENTRAL_PRE_INITIAL_API_KEY>
uuid: <central-uuid>
```

Resposta `200`:
```json
{
  "apiKey": "gcdr_cust_…",
  "scopes": ["central-state:read", "central-environment:read", "central-environment:write"],
  "customerId": "56614a70-326f-11ef-ad2c-53aeabe7d3fa",
  "cached": true
}
```

- **TOFU** (trust-on-first-use): a 1ª chamada **cria** a chave; as seguintes
  **revelam** a mesma (idempotente), enquanto a central estiver
  `awaiting_provisioning`.
- **Janela de bootstrap**: depois que a `CENTRAL_API_KEY` é vinculada (§3), o
  estado vira `provisioned` e este endpoint fica **reset-gated** (`409/423`) até
  uma ação explícita de operador (que rotaciona a INITIAL).
- **Falhas** retornam `401` genérico (pre-key errada / central desconhecida /
  uuid malformado) — sem oracle. Rate-limit por IP, uuid, falhas de pre-key e
  reveals bem-sucedidos.

---

## 3. Mintar a `CENTRAL_API_KEY` (chave cheia)  *(GCDR, operador)*

**Autenticação**: **JWT de operador** (não a INITIAL). A chave cheia é criada
pelo fluxo administrativo normal de customer API keys — a `CENTRAL_INITIAL_API_KEY`
**não pode** criá-la (é escalonamento de privilégio, proibido por design).

```
POST /api/v1/customers/56614a70-…/api-keys      (JWT operador)
{ "name": "Central API Key — <uuid>", "scopes": [ …7 scopes… ], "hierarchyAccess": "SELF" }
```

Ao mintar, o GCDR **vincula** a chave à central
(`centrals.config.centralApiKeyId`) e marca `provisioningState = provisioned`,
fechando a janela de bootstrap.

A ferramenta de **pre-setup** segura **duas** credenciais: o **token de operador**
(para criar a chave cheia) e a **`CENTRAL_INITIAL_API_KEY`** (para gravá-la na
central via `POST /provision`).

---

## 4. Gravar na central — `GET /state` / `POST /provision`  *(device-side, Orange Pi)*

> Estes endpoints são **hospedados pela própria central** (não pelo GCDR). Contrato
> aqui só para referência; a implementação é do time de firmware.

- `POST /provision` (auth: `CENTRAL_INITIAL_API_KEY`) — grava um **allowlist** de
  chaves de `environment` local, no mínimo `CENTRAL_API_KEY`. Valores secretos
  devem ser **cifrados at-rest** no device.
- `GET /state` (auth: `CENTRAL_INITIAL_API_KEY`) — reporta estado; **não** ecoa o
  `CENTRAL_API_KEY` em plaintext (só presença/status).

---

## 5. Endpoints do GCDR atrelados à `CENTRAL_API_KEY`

O que a chave cheia consome no GCDR, por scope. **Status** = existe hoje /
precisa re-gate / novo / device-side.

| Scope | Operação | Endpoint GCDR | Status |
|---|---|---|---|
| `devices:read` / `devices:write` | salvar/ler devices | `GET/POST/PUT /api/v1/devices` | ✅ existe (aceita `X-API-Key`) |
| `devices:read` / `devices:write` | device sync | `/api/v1/device-sync/jobs` | ✅ existe |
| `central-sync:write` | mqtt sync status | `/api/v1/customers/:id/integrations/:key/sync-events` (+ `/reset`, `/disable`) | ⚠️ existe, mas gated por `customers:write` → **re-gate** para aceitar `central-sync:write` |
| `central-data:write` | clear data | *(a definir)* | ❌ **novo** endpoint |
| `central-state:read` | ler estado | central `GET /state` | 🔵 device-side |
| `central-environment:read` / `write` | ler/gravar environment | central `POST /provision` | 🔵 device-side |

**Importante:** o router `/api/v1/centrals/*` usa **JWT de operador** (não
`X-API-Key`), então a `CENTRAL_API_KEY` **não** chama `/centrals` (heartbeat,
mqtt-passwords etc.). O loop da central usa outro caminho (`agent_secret`).

> "Salvar ambientes": se **environment local** → device-side (`/provision`); se
> **assets no GCDR** → `assets:write` em `/api/v1/assets` (já aceita `X-API-Key`).
> Confirmar qual antes de fixar o contrato.

---

## 6. Catálogo de scopes (novos)

| Scope | Enforçado por | Descrição |
|---|---|---|
| `central-state:read` | central | ler o estado de runtime da central |
| `central-environment:read` | central | ler o environment local |
| `central-environment:write` | central | provisionar o environment local |
| `central-data:write` | GCDR | operações de clear-data |
| `central-sync:write` | GCDR | operações de status de sync mqtt |

`central-state`/`central-environment` são **semânticos** na chave GCDR e
**enforçados pela central** ao validar a chave nos endpoints locais. Na UI de API
Keys, ver **RFC-0048** (frontend).

---

## 7. Regras de uso

- **Rotação da `CENTRAL_API_KEY`**: mintar nova → `POST /provision` na central com
  o novo valor → confirmar tráfego → revogar a antiga (`DELETE
  /customers/:id/api-keys/:keyId`). A rotação atualiza o registro em
  `customer_api_keys` **e** o valor cifrado no `environment` da central.
- **Rotação da `CENTRAL_INITIAL_API_KEY`**: só via **reset de operador**, que
  reabre a janela de bootstrap. Não há re-mint automático.
- **Revogação**: chave revogada para de funcionar na hora; operações da central
  passam a falhar com `401/403`.
- **Segredos**: nunca logar plaintext. A `CENTRAL_API_KEY` é recuperável no GCDR
  (reveal auditado, migration 0036) e cifrada no device. `keyPrefix` serve só
  para *identificar*, nunca para autenticar.
- **Pre-key**: se vazar de um firmware, o blast radius é mínimo — só destrava
  buscar a INITIAL de uma central (estreita, revogável) e a janela fecha após o
  provisionamento. Rotacionar a pre-key exige atualização de firmware.

---

## Referências

- `docs/rfcs/RFC-0056-Central-Initial-API-Key-Bootstrap.md` — RFC (design canônico)
- `docs/RFC-0048-Central-Key-Scopes-UI.md` (frontend) — scopes na UI de API Keys
- `docs/api/API-KEYS-CONSUMERS.md` — guia geral de Customer API Keys
- Migration `0036` — Customer API Keys recuperáveis (reveal auditado)
- `docs/GCDR-USER.md` — autenticação e RBAC (canônico)
