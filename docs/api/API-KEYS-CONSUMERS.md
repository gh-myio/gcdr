# Customer API Keys — guia para sistemas consumidores

> Público-alvo: times que integram com o GCDR (orquestrador de alarmes,
> Node-RED, sync ThingsBoard ou qualquer consumidor da árvore de customers).
>
> Contexto: a partir da migration **0036**, as Customer API Keys são
> **recuperáveis** (reveal auditado) e o endpoint de árvore enriquecida passou
> a expor metadados das chaves por customer.

---

## 1. Consumindo `GET /api/v1/customers/:id/tree?deep=1`

**Autenticação**: rota híbrida — aceita **JWT Bearer** ou **`X-API-Key`**
(chave de customer com escopo `customers:read`).

### Mudança no contrato (aditiva, não-breaking)

Cada nó da árvore enriquecida (a raiz e todos os descendentes, recursivamente)
carrega dois campos novos, além de `customer`, `assets`, `centrals` e
`devices`:

```json
{
  "customer": { "id": "…", "name": "…" },
  "assets":   [ "…" ],
  "centrals": [ "…" ],
  "devices":  [ "…" ],
  "apiKeys": [
    {
      "id": "9a1f…",
      "name": "Node-RED Producao",
      "keyPrefix": "a1b2c3d4",
      "scopes": ["bundles:read"],
      "isActive": true,
      "expiresAt": null,
      "lastUsedAt": "2026-06-10T12:00:00Z",
      "createdAt": "2026-06-01T00:00:00Z"
    }
  ],
  "apiKeyCount": 1,
  "children": [ { "…mesma estrutura recursiva…": true } ]
}
```

### Orientações

- **Parser tolerante** — se o consumidor valida o payload com schema estrito,
  adicione `apiKeys` (array, opcional) e `apiKeyCount` (number, opcional).
  Consumidores que ignoram campos desconhecidos não precisam mudar nada.
- **O segredo nunca vem na árvore** — `apiKeys` contém apenas metadados.
  `keyPrefix` (8 primeiros caracteres da parte aleatória) serve para
  *identificar* qual chave é qual — por exemplo, casar com o valor já gravado
  no ThingsBoard — nunca para autenticar.
- **Chave utilizável** = `isActive: true` **e** (`expiresAt` nulo ou no
  futuro). Use isso para decidir se um customer já está provisionado.
- `apiKeyCount` vem do count no banco; a lista `apiKeys` é paginada em até
  100 itens por customer.
- A árvore rasa (`deep=0` ou sem o parâmetro) **não** inclui esses campos.

---

## 2. Manipulando API keys (provisionamento / ThingsBoard)

**Autenticação**: todas as rotas de `/customers/:customerId/api-keys/*`
exigem **JWT** (usuário autenticado). Uma API key M2M **não** pode criar,
revelar ou revogar outras chaves — manipulação é ação administrativa.

| Operação | Endpoint | Observação |
|---|---|---|
| Criar | `POST /customers/:id/api-keys` | resposta inclui `key` (plaintext) + metadados |
| Revelar | `POST /customers/:id/api-keys/:keyId/reveal` | retorna `{ id, key }`; auditado |
| Atualizar | `PUT /customers/:id/api-keys/:keyId` | `name`, `description`, `scopes`, `isActive` |
| Revogar | `DELETE /customers/:id/api-keys/:keyId` | irreversível; para de funcionar na hora |

### Fluxo ThingsBoard

1. Criar (ou revelar) a chave no GCDR.
2. Gravar o valor no atributo **SERVER_SCOPE** do customer no ThingsBoard.
3. O bundle/Node-RED usa esse valor no header `X-API-Key`.

Como a chave é recuperável, o sync pode ser refeito a qualquer momento sem
recriar a chave.

### Regras de uso

- **Reveal é auditado** — cada chamada gera um evento `API_KEY_REVEALED` no
  audit log (usuário, customer e keyId; **nunca** o plaintext). Pode ser usado
  no fluxo operacional, mas cada uso fica rastreado: sistemas automatizados
  **não** devem fazer reveal em loop/polling — revele uma vez e persista no
  destino (TB).
- **Chaves legadas** — chaves criadas **antes da migration 0036** não têm
  plaintext gravado: o reveal retorna **404**. Tratamento: revogar, recriar a
  chave e atualizar o atributo no ThingsBoard. As chaves antigas continuam
  funcionando normalmente; só não são reveláveis.
- **Rotação** — criar chave nova → atualizar o SERVER_SCOPE no TB → confirmar
  tráfego (`lastUsedAt` da nova mexendo) → revogar a antiga.
- **Nunca logar o plaintext** no sistema consumidor; trate a chave como
  secret (mesma disciplina do reveal de senhas MQTT das integrações,
  RFC-0033/0035).

### Semântica de `hierarchyAccess`

Cada chave tem um nível de acesso hierárquico, definido na criação:

| Valor | Significado |
|---|---|
| `SELF` | acessa apenas os dados do próprio customer (padrão) |
| `SUBTREE` | acessa o customer e todos os descendentes (`?deep=1`) |
| `TENANT` | sem restrição de customer (acesso total ao tenant) |

---

## Referências

- `docs/GCDR-USER.md` — autenticação e RBAC (canônico)
- Migration: `drizzle/migrations/0036_customer_api_keys_recoverable.sql`
- Auditoria: evento `API_KEY_REVEALED` (RFC-0009, audit logs locais)
