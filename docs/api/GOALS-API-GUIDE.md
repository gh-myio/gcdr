# Consumption Goals — guia de API para consumidores

> Público-alvo: times que integram com o GCDR (dashboards, Node-RED,
> orquestrador de alarmes, scripts de import de metas) e precisam ler ou
> escrever **metas de consumo** por cliente.
>
> Contexto: **RFC-0046** criou o domínio de metas (ENERGY / WATER /
> TEMPERATURE) com grão canônico horário. A spec formal vive em
> `docs/openapi.yaml` (tag **Goals**) e no Swagger — local
> `http://localhost:3015/docs`, prod `https://gcdr-api.a.myio-bas.com/docs/`.

---

## 1. Modelo conceitual

Uma meta é identificada por **(customer × domain × year)** — ex.:
`Moxuara × ENERGY × 2026`. Internamente só existe **um grão armazenado: a
hora** (8760 buckets/ano). Tudo o mais é derivado na leitura:

- **ENERGY / WATER** — roll-up por **soma** (`method: "SUM"`); valores ≥ 0.
- **TEMPERATURE** — roll-up por **média ponderada**; aceita negativos.

Escritas em níveis mais grossos (ano/mês/dia) são **distribuídas** pelo
servidor para as horas (`distributed: true` no histórico). O nível mais fino
enviado sempre vence.

**Versionamento**: cada mutação (import, replace, merge, delete, edição)
produz **uma versão** (`version` incrementa) e **uma entrada de histórico**
com ator e timestamp — auditoria de graça.

## 2. Autenticação e limites

- Rota híbrida por método: **GET** exige scope `goals:read`; **PUT / PATCH /
  POST / DELETE** exigem `goals:write`. Aceita **JWT Bearer** ou
  **Customer API Key** (`X-API-Key: gcdr_cust_…`, alcance conforme
  `hierarchyAccess` — ver `API-KEYS-CONSUMERS.md`).
- **Rate limit**: 240 req/min por IP+customer; excedeu → `429 RATE_LIMITED`.

## 3. Endpoints

Base: `/api/v1/customers/:customerId/goals`

| Operação | Endpoint | Observação |
|---|---|---|
| Listar domínios | `GET /goals` (sem query) | resumo: quais (domain, year) têm meta |
| Ler árvore | `GET /goals?domain=&year=&granularity=&fetchHistory=` | `granularity`: `year` \| `month` (padrão) \| `day` \| `hour` |
| Substituir ano | `PUT /goals?domain=&year=` | REPLACE: o payload É o ano inteiro; o que não vier é removido |
| Mesclar buckets | `PATCH /goals?domain=&year=` | MERGE: só os buckets enviados mudam (1..8760) |
| Importar CSV | `POST /goals/import?domain=&year=&dryRun=` | `dryRun=true` (padrão) = preview sem persistir |
| Apagar | `DELETE /goals?domain=&year=` | ano inteiro (204) ou sub-bucket via body (200) |
| Rebalancear medidores | `POST /goals/rebalance?domain=&year=&dryRun=` | Addendum A — ver §7 |

Todas as escritas aceitam **`expectedVersion`** no body (lock otimista);
divergência → `409 VERSION_CONFLICT` com `currentVersion` no erro.
Todos os endpoints (menos o rebalance) aceitam **`?deviceId=`** para operar
sobre UM medidor de entrada — ver §7 (metas por medidor).

## 4. Leitura

```bash
curl -s "https://gcdr-api.a.myio-bas.com/api/v1/customers/<CUSTOMER_UUID>/goals?domain=ENERGY&year=2026&granularity=hour" \
  -H "X-API-Key: $GCDR_API_KEY"
```

```jsonc
{
  "success": true,
  "data": {
    "customerId": "84e0370e-…",
    "domain": "ENERGY",
    "unit": "kWh",
    "aggregationMethod": "SUM",
    "year": 2026,
    "version": 7,
    "tree": {
      "annual":  { "value": 10447565.08, "method": "SUM" },
      "monthly": { "05": { "value": 860365.01, "method": "SUM", "sourceLevel": "HOUR", "derived": false }, … },
      "daily":   { "05-13": { "value": 27753.71, … }, … },        // granularity >= day
      "hourly":  { "05-13T17": { "value": 1592.935, … }, … }      // granularity = hour
    }
  }
}
```

- Chaves derivadas: `monthly["MM"]`, `daily["MM-DD"]`, `hourly["MM-DDThh"]`
  (o ano está no discriminador da query).
- `granularity=hour` retorna ~8760 nós (<1 MB) — peça só o nível que precisa.
- `fetchHistory=true` adiciona o array `history` (≤100 entradas mais
  recentes): `{ source, actionLevel, bucketRef, oldValue, newValue,
  bucketCount, details[≤50], distributed, hoursAffected, version, actor,
  changedAt }`.

## 5. Escrita

### 5.1 Import CSV (o caminho recomendado para carga anual)

Formato: cabeçalho `bucket,value`, separador `,` ou `|`, uma linha por
bucket. Referências **incluem o ano** e aceitam qualquer mistura de níveis —
o mais fino vence:

```csv
bucket,value
2026,10000000          # ano inteiro (distribuído)
2026-03,900000         # mês
2026-03-15,31000       # dia
2026-03-15T08,1500     # hora
```

Fluxo em duas fases (é o que a UI usa):

```bash
# 1) preview — nada é salvo; retorna válidas/erros e o que "será aplicado"
curl -s -X POST ".../goals/import?domain=ENERGY&year=2026&dryRun=true" \
  -H "X-API-Key: $GCDR_API_KEY" -H "Content-Type: application/json" \
  -d "{\"csv\": $(python -c 'import json,sys;print(json.dumps(open(sys.argv[1]).read()))' goals-2026.csv)}"

# 2) confirmar — persiste via merge e cria a versão
curl -s -X POST ".../goals/import?domain=ENERGY&year=2026&dryRun=false" \
  -H "X-API-Key: $GCDR_API_KEY" -H "Content-Type: application/json" \
  -d '{"csv": "…", "expectedVersion": 7}'
```

O import é **stateless**: o preview não gera token; confirme reenviando o
mesmo CSV com `dryRun=false`.

### 5.2 PATCH merge (ajustes pontuais)

```bash
curl -s -X PATCH ".../goals?domain=ENERGY&year=2026" \
  -H "X-API-Key: $GCDR_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "buckets": [
      { "level": "DAY",  "ref": "2026-12-24", "value": 52000 },
      { "level": "HOUR", "ref": "2026-12-24T18", "value": 3100 }
    ],
    "expectedVersion": 7
  }'
```

`ref` segue o nível: `"2026"` (YEAR) · `"2026-03"` (MONTH) ·
`"2026-03-15"` (DAY) · `"2026-03-15T08"` (HOUR). Buckets não enviados são
preservados.

### 5.3 PUT replace (reescrever o ano)

Body espelha a árvore de leitura (`annual` e/ou `monthly` → `daily` →
`hourly`, chaves zero-padded `"01".."12"` / `"01".."31"` / `"00".."23"`).
Tudo que não estiver no payload é **removido**. Use para reconstruir; para
carga a partir de planilha, prefira o import CSV.

### 5.4 DELETE

```bash
# ano inteiro, sem guard → 204
curl -s -X DELETE ".../goals?domain=ENERGY&year=2026" -H "X-API-Key: $GCDR_API_KEY"

# só um sub-bucket, com guard → 200 + body
curl -s -X DELETE ".../goals?domain=ENERGY&year=2026" \
  -H "X-API-Key: $GCDR_API_KEY" -H "Content-Type: application/json" \
  -d '{"bucket": {"level": "MONTH", "ref": "2026-06"}, "expectedVersion": 8}'
```

## 6. Orientações

- **Sempre envie `expectedVersion`** em escrita automatizada; trate 409
  relendo (`GET`) e reavaliando — nunca retry cego.
- **Valores**: finitos; ≥ 0 para ENERGY/WATER; TEMPERATURE aceita negativos.
  Fora disso → `400/422 VALIDATION_ERROR` com o path do bucket ofensor.
- **Parser tolerante** — novos campos podem aparecer nos nós da árvore e no
  envelope; ignore o que não conhecer. Já no ar: `adjustedValue` ao lado de
  `value` + bloco `goalMargin` (**RFC-0052**, margem percentual por
  customer × domain × year) e, no GET, `granularity`, `devices[]`,
  `hoursCovered` e `coverageGaps` (**Addendum A** — §7).
- **Não recalcule roll-ups no cliente** — peça a `granularity` desejada; o
  servidor deriva com o método correto por domínio (SUM vs média ponderada).
- **Auditoria**: não logue mudanças por fora — `fetchHistory=true` traz quem,
  quando, o quê (old→new) e quantas horas foram afetadas.
- **Ano-alvo**: um CSV com refs de ano diferente do `year` da query é
  rejeitado no preview — o discriminador é a query, não o CSV.

## 7. Metas por medidor (Addendum A)

Um ano de meta pode ser detalhado **por medidor de entrada** (`granularity:
'DEVICE'`). Regras essenciais para consumidores:

- **Pré-requisito**: os medidores participantes são os devices do customer
  cadastrados com `meterRole: 'ENTRY'` + `meterDomain` igual ao domínio da
  meta (classificação explícita no cadastro — nada é inferido). Sem medidor
  classificado, writes com `deviceId` → `422 GOAL_ENTRY_SET_UNDEFINED`.
  v1 só cobre domínios SUM (ENERGY/WATER).
- **`?deviceId=`** em GET/PUT/PATCH/import/DELETE opera sobre UM medidor.
  O primeiro write com `deviceId` num ano CUSTOMER **converte** o ano:
  valores existentes viram total do grupo por hora, o alvo fica EXPLICIT e
  os demais medidores absorvem o residual (total preservado, 1 versão).
- **Alocação mista**: valores explícitos são pinados; o residual
  (total − Σ explícitos) divide igual entre os medidores sem meta
  (`allocation: RESIDUAL`). Estourou o total → `400 GOAL_DEVICE_OVERFLOW`.
- **Escrita sem `deviceId`** num ano DEVICE edita o **total do grupo**
  (explícitos pinados, residuais rebalanceiam). Um `PUT` sem device precisa
  declarar `granularity: 'CUSTOMER'` (colapsa, destrutivo) ou `'DEVICE'`.
- **Remoção**: apagar a meta de um medidor EXPLICIT redistribui a parcela
  aos RESIDUAL (total preservado); sem residual, declare
  `mode: 'shrink-total'` no body ou receba `409 GOAL_REMOVAL_MODE_REQUIRED`.
- **Rebalance explícito**: cadastrar/reclassificar medidor **nunca** mexe em
  metas. Para convergir ao ENTRY set atual:
  `POST /goals/rebalance?domain=&year=&dryRun=true` (preview antes/depois
  por medidor, `entering`/`leaving`) e depois `dryRun=false` com
  `expectedVersion` (1 versão, 1 entrada `REBALANCE` no histórico).
- **Leitura (GET)** ganha: `granularity`, `devices[]`
  (`{deviceId, code, label, allocation, annual, annualAdjusted,
  hoursCovered, coverageGaps?}`), `hoursCovered` consolidado e
  `coverageGaps` (refs compactas dos buracos: mês inteiro `YYYY-MM` > dia
  `YYYY-MM-DD` > hora `YYYY-MM-DDThh`; cap de 12 + `truncated` +
  `missingHours`). O consolidado de um ano DEVICE omite
  `sourceLevel`/`derived` nos nós (ambíguos entre medidores).
- **Import por sensor**: 1 CSV por medidor (mesmo formato do §5.1),
  importado com `?deviceId=`. CSV único com coluna `device` está no backlog.

## Referências

- `docs/openapi.yaml` — spec formal (tag **Goals**, schemas `GoalTree`,
  `GoalHistoryEntry`)
- `docs/rfcs/RFC-0046-Customer-Consumption-Goals.md` — design do domínio
- `docs/rfcs/RFC-0046-Goals-API.md` — contrato detalhado (§2 árvore, §4.4
  conflito de versão, **§7 deltas do Addendum A**)
- `docs/rfcs/RFC-0046-Addendum-A-Device-Granular-Goals.md` — metas por
  medidor (APPROVED rev. 2)
- `docs/goals/GOALS-RELEASE-NOTES-2026-07.md` — release notes desta leva
  (backend, regras e UI)
- `docs/rfcs/RFC-0052-Goal-Margin-Adjustment.md` — margem percentual
  (`goalMarginPct`) com `adjustedValue` na leitura
- `docs/api/API-KEYS-CONSUMERS.md` — API keys e `hierarchyAccess`
- Exemplos reais de CSV horário: `docs/examples/goals-2026-*-Energy-import.csv`
