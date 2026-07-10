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

Todas as escritas aceitam **`expectedVersion`** no body (lock otimista);
divergência → `409 VERSION_CONFLICT` com `currentVersion` no erro.

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
- **Parser tolerante** — novos campos podem aparecer nos nós da árvore;
  ignore o que não conhecer. Em particular, o **RFC-0052 (draft)** adicionará
  `adjustedValue` ao lado de `value` e um bloco `goalMargin` (margem
  percentual por customer × domain × year) — consumidores estritos devem
  prever campos opcionais desde já.
- **Não recalcule roll-ups no cliente** — peça a `granularity` desejada; o
  servidor deriva com o método correto por domínio (SUM vs média ponderada).
- **Auditoria**: não logue mudanças por fora — `fetchHistory=true` traz quem,
  quando, o quê (old→new) e quantas horas foram afetadas.
- **Ano-alvo**: um CSV com refs de ano diferente do `year` da query é
  rejeitado no preview — o discriminador é a query, não o CSV.

## Referências

- `docs/openapi.yaml` — spec formal (tag **Goals**, schemas `GoalTree`,
  `GoalHistoryEntry`)
- `docs/rfcs/RFC-0046-Customer-Consumption-Goals.md` — design do domínio
- `docs/rfcs/RFC-0046-Goals-API.md` — contrato detalhado (§2 árvore, §4.4 conflito de versão)
- `docs/rfcs/RFC-0052-Goal-Margin-Adjustment.md` — **draft**: margem
  percentual (`goalMarginPct`) com `adjustedValue` na leitura
- `docs/api/API-KEYS-CONSUMERS.md` — API keys e `hierarchyAccess`
- Exemplos reais de CSV horário: `docs/examples/goals-2026-*-Energy-import.csv`
