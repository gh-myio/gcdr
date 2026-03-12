# FRONTEND — Device Sync Job API

Guia de integração frontend para o endpoint de sincronização de devices (`/api/v1/device-sync/jobs`).
Baseado em: [RFC-0023](./RFC-0023-Device-Sync-Job-API.md)

---

## Autenticação

Todos os endpoints exigem **Partner API Key** no header:

```
X-API-Key: gcdr_pk_...
```

---

## 1. Criar Job

**`POST /api/v1/device-sync/jobs`**

Cria e enfileira um novo job de sincronização. Retorna `202 Accepted` imediatamente — o job roda em background.

### Request Body

```json
{
  "customerId":     "84e0370e-636a-4741-9874-504b5e0b3577",
  "defaultAssetId": "8a9c669b-855f-4c2f-bd60-e0541238b980",
  "dryRun":         false,
  "files": [
    {
      "name":    "energy-stores",
      "content": "tbId|deviceName|label|identifier|deviceType|deviceProfile|slaveId|centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt\n52ea1510-b4dd-11f0-be7f-e760d1498268|3F SCMOXUARA102BCL1|SUPERMERCADOS_BH|102BC_L1|3F_MEDIDOR|3F_MEDIDOR|2|e982edf9-edb1-4aa6-8a14-4782465ae5a3|||8dfc9f80-342e-48e7-a949-6e92718b0085|\n..."
    },
    {
      "name":    "water-stores",
      "content": "tbId|deviceName|label|...\n..."
    }
  ]
}
```

### Campos

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `customerId` | `uuid` | Sim | Customer alvo da sincronização |
| `defaultAssetId` | `uuid` | Não | Asset padrão usado quando `gcdrAssetId` estiver vazio no arquivo |
| `dryRun` | `boolean` | Não (default: `false`) | Se `true`, simula todas as operações sem escrever no banco |
| `files` | `array` | Sim | Lista de arquivos device-map (mín. 1, máx. 20) |
| `files[].name` | `string` | Sim | Nome lógico do arquivo (sem extensão) |
| `files[].content` | `string` | Sim | Conteúdo pipe-delimitado do arquivo device-map |

### Validações

- `customerId` — UUID válido
- `files` — entre 1 e 20 itens
- `files[].name` — entre 1 e 255 caracteres
- `files[].content` — não vazio; primeira linha deve ser o header `tbId|deviceName|...`; máx. ~500 KB por arquivo
- `files[].content` linhas em branco e linhas começando com `[` são ignoradas (section headers)

### Response `202 Accepted`

```json
{
  "success": true,
  "data": {
    "jobId":  "d3b8a1f0-9c2e-4a11-b3c7-000000000099",
    "status": "QUEUED"
  }
}
```

### Erros

```json
// 400 — validação
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "customerId": ["Invalid uuid"],
      "files": ["Array must contain at least 1 element(s)"]
    }
  }
}

// 401 — API Key ausente ou inválida
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key"
  }
}

// 404 — customerId não encontrado no tenant
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Customer d3b8a1f0-... not found"
  }
}
```

---

## 2. Status do Job

**`GET /api/v1/device-sync/jobs/:jobId`**

Retorna o status atual e o resumo por fase. Use para polling até `status` ser `DONE`, `PARTIAL` ou `FAILED`.

### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "jobId":        "d3b8a1f0-9c2e-4a11-b3c7-000000000099",
    "status":       "DONE",
    "currentPhase": "DONE",
    "dryRun":       false,
    "summary": {
      "check": {
        "conformant": 298,
        "divergent":   17,
        "notLinked":    0
      },
      "actionPlan": {
        "create":            0,
        "update":           17,
        "updateIdentifier":  0,
        "skip":            298
      },
      "detectRelocations": {
        "relocate":       0,
        "genuineCreates": 0
      },
      "relocate":           { "ok": 0,  "fail": 0 },
      "applyUpdates":       { "ok": 17, "fail": 0 },
      "consolidateCreates": { "ok": 0,  "fail": 0 }
    },
    "createdAt":   "2026-03-11T19:00:00.000Z",
    "updatedAt":   "2026-03-11T19:00:08.432Z",
    "completedAt": "2026-03-11T19:00:08.432Z",
    "durationMs":  8432
  }
}
```

### Valores de `status`

| Valor | Descrição |
|-------|-----------|
| `QUEUED` | Aguardando início |
| `RUNNING` | Em execução |
| `DONE` | Concluído sem falhas |
| `PARTIAL` | Concluído com ≥1 operação com falha — inspecionar log |
| `FAILED` | Erro fatal — exceção não tratada em alguma fase |

### Valores de `currentPhase`

| Fase | Descrição |
|------|-----------|
| `QUEUED` | Ainda não iniciou |
| `CHECK` | Comparando device-maps com GCDR |
| `ACTION_PLAN` | Classificando ações (CREATE / UPDATE / SKIP) |
| `DETECT_RELOCATIONS` | Detectando devices em customer errado |
| `RELOCATE` | Movendo devices para customer correto |
| `APPLY_UPDATES` | Aplicando patches nos campos divergentes |
| `CONSOLIDATE_CREATES` | Criando devices novos |
| `DONE` | Concluído |

### Erros

```json
// 404 — jobId não encontrado (ou pertence a outro tenant)
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Job d3b8a1f0-... not found"
  }
}
```

---

## 3. Log do Job

**`GET /api/v1/device-sync/jobs/:jobId/log`**

Retorna o log estruturado completo do job com uma entrada por operação.

### Response `200 OK`

```json
{
  "success": true,
  "data": {
    "jobId":  "d3b8a1f0-9c2e-4a11-b3c7-000000000099",
    "status": "PARTIAL",
    "entries": [
      {
        "ts":      "2026-03-11T19:00:00.100Z",
        "phase":   "CHECK",
        "level":   "INFO",
        "message": "energy-stores: 158 CONFORMANT, 6 DIVERGENT, 0 NOT_LINKED"
      },
      {
        "ts":      "2026-03-11T19:00:01.200Z",
        "phase":   "ACTION_PLAN",
        "level":   "INFO",
        "message": "Classified: 0 CREATE, 6 UPDATE, 0 UPDATE_IDENTIFIER, 158 SKIP"
      },
      {
        "ts":      "2026-03-11T19:00:02.400Z",
        "phase":   "APPLY_UPDATES",
        "level":   "OK",
        "message": "3F SCMOXUARA315DEL3 — patched: label"
      },
      {
        "ts":      "2026-03-11T19:00:02.500Z",
        "phase":   "APPLY_UPDATES",
        "level":   "FAIL",
        "message": "HIDR. SCMOXUARA108BL1 — Device with central e982edf9-... and slave ID 232 already exists"
      },
      {
        "ts":      "2026-03-11T19:00:08.400Z",
        "phase":   "DONE",
        "level":   "INFO",
        "message": "Job complete — 16 OK, 1 FAIL"
      }
    ]
  }
}
```

### Valores de `level`

| Valor | Cor sugerida | Descrição |
|-------|-------------|-----------|
| `INFO` | cinza/azul | Progresso informativo |
| `WARN` | amarelo | Device não encontrado, ação não realizada |
| `OK` | verde | Operação bem-sucedida |
| `FAIL` | vermelho | Operação falhou — device não processado |
| `ERROR` | vermelho escuro | Erro fatal na fase |

---

## 4. Listar Jobs

**`GET /api/v1/device-sync/jobs`**

Lista jobs do tenant com suporte a filtros e paginação.

### Query Parameters

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `customerId` | `uuid` | Filtrar por customer |
| `status` | `string` | Filtrar por status (`QUEUED`, `RUNNING`, `DONE`, `PARTIAL`, `FAILED`) |
| `page` | `number` | Página (default: 1) |
| `pageSize` | `number` | Itens por página (default: 20, máx: 100) |

### Exemplo

```
GET /api/v1/device-sync/jobs?customerId=84e0370e-...&status=DONE&page=1&pageSize=10
```

### Response `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "jobId":        "d3b8a1f0-9c2e-4a11-b3c7-000000000099",
      "status":       "DONE",
      "currentPhase": "DONE",
      "dryRun":       false,
      "customerId":   "84e0370e-636a-4741-9874-504b5e0b3577",
      "summary": {
        "check":              { "conformant": 298, "divergent": 17, "notLinked": 0 },
        "actionPlan":         { "create": 0, "update": 17, "updateIdentifier": 0, "skip": 298 },
        "detectRelocations":  { "relocate": 0, "genuineCreates": 0 },
        "relocate":           { "ok": 0,  "fail": 0 },
        "applyUpdates":       { "ok": 17, "fail": 0 },
        "consolidateCreates": { "ok": 0,  "fail": 0 }
      },
      "createdAt":   "2026-03-11T19:00:00.000Z",
      "completedAt": "2026-03-11T19:00:08.432Z",
      "durationMs":  8432
    }
  ],
  "pagination": {
    "page":       1,
    "pageSize":   10,
    "total":      3,
    "totalPages": 1
  }
}
```

---

## Fluxo de Uso (Frontend)

```
1. POST /device-sync/jobs          → recebe jobId + status=QUEUED
2. polling GET /device-sync/jobs/:jobId  (ex: a cada 2s)
   └─ enquanto status == QUEUED | RUNNING → atualizar currentPhase na UI
3. quando status == DONE | PARTIAL | FAILED → parar polling
4. GET /device-sync/jobs/:jobId/log → exibir log completo
   └─ filtrar entries por level=FAIL para destacar erros
```

### Sugestão de estado da UI por `status`

| `status` | Indicador |
|----------|-----------|
| `QUEUED` | Spinner — "Aguardando..." |
| `RUNNING` | Spinner + fase atual (`currentPhase`) |
| `DONE` | Badge verde — "Concluído" |
| `PARTIAL` | Badge amarelo — "Concluído com erros" |
| `FAILED` | Badge vermelho — "Falha" |

### Sugestão de progresso por `currentPhase`

```
QUEUED              → 0%
CHECK               → 15%
ACTION_PLAN         → 30%
DETECT_RELOCATIONS  → 45%
RELOCATE            → 55%
APPLY_UPDATES       → 70%
CONSOLIDATE_CREATES → 85%
DONE                → 100%
```

---

## Formato do Device-Map (`files[].content`)

Pipe-delimited, primeira linha é o header:

```
tbId|deviceName|label|identifier|deviceType|deviceProfile|slaveId|centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt
```

| Coluna | Descrição | Obrigatório |
|--------|-----------|-------------|
| `tbId` | UUID do device no ThingsBoard (vira `externalId` no GCDR) | Sim |
| `deviceName` | Nome do device | Sim |
| `label` | Label/nome do inquilino/local | Não |
| `identifier` | Identificador lógico (ex: `102BC_L1`) | Não |
| `deviceType` | Tipo (ex: `3F_MEDIDOR`, `HIDROMETRO`) | Não |
| `deviceProfile` | Perfil (ex: `3F_MEDIDOR`, `ESCADA_ROLANTE`) | Não |
| `slaveId` | Endereço Modbus/slave (inteiro) | Não |
| `centralId` | UUID da central de dados | Não |
| `gcdrCustomerId` | UUID do customer no GCDR (sobrepõe `defaultAssetId`) | Não |
| `gcdrAssetId` | UUID do asset no GCDR | Não |
| `gcdrDeviceId` | UUID do device no GCDR (lookup Priority 1) | Não |
| `gcdrSyncAt` | Timestamp da última sync | Não |

Linhas em branco e linhas iniciando com `[` são ignoradas.
