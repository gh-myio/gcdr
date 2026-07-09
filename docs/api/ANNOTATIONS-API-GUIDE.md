# Annotations — guia de API para consumidores

> Público-alvo: times que integram com o GCDR (frontend, orquestrador de
> alarmes, Node-RED, scripts de migração ThingsBoard) e precisam ler ou
> escrever anotações sobre devices, ordens de serviço ou eventos de OS.
>
> Contexto: **RFC-0036** trouxe as anotações do ThingsBoard para o GCDR como
> agregado próprio e polimórfico. A spec formal vive em `docs/openapi.yaml`
> (tag **Annotations**) e no Swagger — local `http://localhost:3015/docs`,
> prod `https://gcdr-api.a.myio-bas.com/docs/`.

---

## 1. Modelo conceitual

Uma **annotation** é o aggregate root; tudo o mais pende dela:

| Recurso | O que é |
|---|---|
| `annotation` | texto (máx. 255), `type`, `importance` 1–5, `dueDate` opcional |
| `responses` | comentários e decisões (aprovar / rejeitar / arquivar) |
| `events` | histórico append-only de tudo que aconteceu (auditoria) |
| `mentions` | menções a usuários (`@nome` na UI) ou devices |
| `attachments` | vínculos a arquivos já existentes em `file_assets` |

**Alvo polimórfico** — toda anotação aponta para uma entidade via
`entityType` + `entityId`:

- `device` — anotações operacionais de campo (caso migrado do ThingsBoard)
- `work_order` — observações de uma OS
- `work_order_event` — observações de um evento específico da OS

**Tipos** (`type`): `observation` (padrão) · `pending` · `maintenance` ·
`activity`. **Importância** (`importance`): 1 (muito baixa) a 5 (muito alta),
padrão 3.

### Ciclo de vida

```
created ──(PATCH)──▶ modified ──┐
   │                            ├──(approved | rejected | archived)──▶ finalized
   └────────────────────────────┘
```

- Anotação **finalizada é imutável**: PATCH, novas responses e detach de
  anexos retornam **409**. `finalizedReason` diz como terminou
  (`approved` / `rejected` / `archived`).
- Arquivada continua legível — na listagem, use `includeArchived=true` para
  vê-la (o padrão oculta).

### Identidade do ator

`createdBy`, `updatedBy` e o `actor` dos eventos são **snapshots**
`{ id, email, name }` congelados no momento da ação — não referenciam a
tabela de usuários (usuário deletado não quebra o histórico).

---

## 2. Autenticação

Rota registrada com o middleware híbrido padrão (`/api/v1/annotations`):

- **JWT Bearer** (`Authorization: Bearer …`) — frontend / usuários.
- **Customer API Key** (`X-API-Key: gcdr_cust_…`) — M2M; `X-Tenant-Id` é
  opcional (auto-descoberto da chave). O alcance segue o
  `hierarchyAccess` da chave (`SELF` / `SUBTREE` / `TENANT` — ver
  `API-KEYS-CONSUMERS.md`).

Toda anotação carrega `customerId` (obrigatório na criação) — é ele que
ancora a visibilidade por hierarquia de customer.

---

## 3. Endpoints

| Operação | Endpoint | Observação |
|---|---|---|
| Listar | `GET /annotations` | filtros abaixo; paginado (`items` + `pagination`) |
| Criar | `POST /annotations` | pode já incluir `mentions` inline |
| Detalhar | `GET /annotations/:id` | **completo**: responses + events + mentions + attachments |
| Editar | `PATCH /annotations/:id` | lock otimista (`If-Match` ou `version`); 409 em conflito |
| Arquivar | `POST /annotations/:id/archive` | finaliza; 409 se já finalizada |
| Responder | `POST /annotations/:id/responses` | `comment` não finaliza; `approved`/`rejected`/`archived` finalizam |
| Mencionar | `POST /annotations/:id/mentions` | `mentionType: user \| device` |
| Anexar | `POST /annotations/:id/attachments` | vincula `fileAssetId` existente |
| Desanexar | `DELETE /annotations/:id/attachments/:attId` | só em anotação ativa; 204 |

### Filtros do `GET /annotations`

`entityType` + `entityId` (o par usual — "tudo deste device/OS"),
`customerId`, `type`, `status` (`created` / `modified` / `archived`),
`importance`, `mentionedUserId`, `mentionedDeviceId`, `hasAttachments`,
`includeArchived`, mais paginação padrão (`page`, `limit`).

A listagem retorna o shape **resumido** (`Annotation`); responses, eventos,
menções e anexos só vêm no `GET /annotations/:id` (`AnnotationDetail`).

---

## 4. Exemplos

### Listar anotações de um device

```bash
curl -s "https://gcdr-api.a.myio-bas.com/api/v1/annotations?entityType=device&entityId=<DEVICE_UUID>&includeArchived=true" \
  -H "X-API-Key: $GCDR_API_KEY"
```

### Criar uma anotação (com menção inline)

```bash
curl -s -X POST "https://gcdr-api.a.myio-bas.com/api/v1/annotations" \
  -H "X-API-Key: $GCDR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "entityType": "device",
    "entityId":   "<DEVICE_UUID>",
    "customerId": "<CUSTOMER_UUID>",
    "text":       "Sensor com leitura intermitente desde ontem",
    "type":       "pending",
    "importance": 4,
    "dueDate":    "2026-07-15T12:00:00Z",
    "mentions":   [{ "mentionType": "user", "mentionedUserId": "<USER_UUID>" }]
  }'
```

Resposta `201` com `AnnotationDetail` (inclui `version: 1`).

### Editar com lock otimista

```bash
curl -s -X PATCH "https://gcdr-api.a.myio-bas.com/api/v1/annotations/<ID>" \
  -H "X-API-Key: $GCDR_API_KEY" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "1"' \
  -d '{ "importance": 5 }'
```

`If-Match` (preferido) ou campo `version` no body. Divergência → **409**;
releia a anotação e reaplique a mudança.

### Rejeitar (decisão finalizadora)

```bash
curl -s -X POST "https://gcdr-api.a.myio-bas.com/api/v1/annotations/<ID>/responses" \
  -H "X-API-Key: $GCDR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "type": "rejected", "text": "Duplicada da OS-2026-0143" }'
```

`text` é **obrigatório para todos os tipos exceto `approved`** (justificativa
de rejeição/arquivamento e corpo de comentário).

### Anexar um arquivo

O upload é feito **antes**, pela API de arquivos (`file_assets`); aqui só se
vincula o id:

```bash
curl -s -X POST "https://gcdr-api.a.myio-bas.com/api/v1/annotations/<ID>/attachments" \
  -H "X-API-Key: $GCDR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "fileAssetId": "<FILE_ASSET_UUID>" }'
```

`responseId` opcional prende o anexo (ou a menção) a uma response específica
em vez da anotação como um todo.

---

## 5. Orientações

- **Concorrência** — sempre envie `If-Match`/`version` em PATCH/archive se o
  seu sistema puder editar concorrentemente com a UI; trate 409 relendo.
- **409 ≠ erro transitório** — em responses/PATCH, 409 também significa
  "anotação já finalizada". Não faça retry cego; cheque `finalized` no GET.
- **Parser tolerante** — novos campos podem ser adicionados ao shape; ignore
  campos desconhecidos.
- **Auditoria de graça** — não registre logs próprios de mudança: o array
  `events` do detail já traz ação, ator, versão anterior e diff (`changes`).
- **Timeline de OS** — anotações de `work_order`/`work_order_event` aparecem
  na timeline da OS como marcadores `OBSERVACAO`/`ANEXO` (carregam
  `annotationId`) — ver `WO-OS-API-GUIDE.md`.
- **Dados migrados do ThingsBoard** — anotações importadas (RFC-0036)
  preservam autor, datas e histórico originais via snapshot de ator e
  `legacy_id` interno (dedup de reimport). Para o consumidor são anotações
  comuns; a migração é idempotente.

---

## Referências

- `docs/openapi.yaml` — spec formal (tag **Annotations**, schemas
  `Annotation*`)
- `docs/rfcs/RFC-0036-Device-Annotations-Migration.md` — design, schema das 5
  tabelas e estratégia de migração ThingsBoard → GCDR
- `docs/api/API-KEYS-CONSUMERS.md` — obtenção/rotação de Customer API Keys e
  semântica de `hierarchyAccess`
- `docs/WO-OS-API-GUIDE.md` — timeline de OS (marcadores de anotação/anexo)
