# Arquitetura — Device Sync Jobs (RFC-0023)

Sistema de sincronização assíncrona de devices entre ThingsBoard (TB) e GCDR, exposto como Job API REST.

**Implementado em:** `src/services/DeviceSyncJobService.ts`
**RFC:** [RFC-0023](./RFC-0023-Device-Sync-Job-API.md)
**Guia Frontend:** [FRONTEND-Device-Sync-Jobs.md](./FRONTEND-Device-Sync-Jobs.md)

---

## Motivação

Antes desta feature, a sincronização de devices era feita por um conjunto de shell scripts (`check-inconformidades.sh`, `consolidate-creates.sh`, `apply-updates.sh`) que rodavam localmente pela equipe de operações. Os problemas:

- Execução manual e dependente de ambiente local
- Sem observabilidade em produção
- Sem histórico de execuções
- Impossível de acionar via UI/frontend
- Centenas de chamadas HTTP N+1 (uma por device)

A Job API resolve isso internalizando o pipeline no GCDR, com armazenamento de log estruturado e polling via REST.

---

## Decisão Arquitetural: `setImmediate` vs BullMQ

O job roda em background usando **`setImmediate()`** — sem fila externa, sem Redis.

**Por quê:**

| Critério | setImmediate | BullMQ (Redis) |
|----------|-------------|----------------|
| Complexidade de infra | Nenhuma | Redis obrigatório |
| Persistência entre restarts | Não (job perde-se) | Sim |
| Concorrência entre instâncias | Sem coordenação | Coordenado |
| Adequado para | Operações batch pontuais por operador | Fila de alta frequência |

Para o caso de uso atual (sync manual por operador, baixa frequência), `setImmediate` é suficiente. A migração para BullMQ está mapeada como melhoria futura na RFC.

**Risco:** se o servidor reiniciar durante um job `RUNNING`, o job ficará preso nesse status. Workaround: operador pode identificar e re-criar o job.

---

## Fluxo do Pipeline

```
POST /device-sync/jobs
        │
        ▼
┌─────────────────┐
│  INSERT job     │  status=QUEUED
│  (DB)           │
└────────┬────────┘
         │  setImmediate()
         ▼
┌────────────────────────────────────────────────────────────┐
│                    runJob() — background                   │
│                                                            │
│  1. CHECK                                                  │
│     Parse device-map files (pipe-delimited)                │
│     Fetch all customer devices from GCDR (limit 10k)       │
│     Build lookup maps: byId, byExternalId, byCentralSlave  │
│     Classify each row: CONFORMANT | DIVERGENT | NOT_LINKED │
│                                                            │
│  2. ACTION_PLAN                                            │
│     DIVERGENT → UPDATE ou UPDATE_IDENTIFIER                │
│     NOT_LINKED → CREATE                                    │
│     CONFORMANT → SKIP                                      │
│                                                            │
│  3. DETECT_RELOCATIONS                                     │
│     Para cada CREATE: busca o device no tenant inteiro     │
│     Se encontrado em outro customer → RELOCATE             │
│     Se não encontrado → genuine CREATE                     │
│                                                            │
│  4. RELOCATE                                               │
│     Chama DeviceRepository.move() para cada relocation     │
│                                                            │
│  5. APPLY_UPDATES                                          │
│     Chama DeviceRepository.update() para cada UPDATE       │
│     Campos patcheados: name, displayName, label,           │
│     identifier, deviceType, deviceProfile, slaveId,        │
│     externalId                                             │
│                                                            │
│  6. CONSOLIDATE_CREATES                                    │
│     Chama DeviceRepository.create() para cada genuine      │
│     CREATE. Default type=METER.                            │
│                                                            │
│  → DONE | PARTIAL | FAILED                                 │
└────────────────────────────────────────────────────────────┘
```

### Status de encerramento

| Status | Condição |
|--------|----------|
| `DONE` | Todas as operações concluídas sem falhas |
| `PARTIAL` | ≥1 operação com falha (reloc/update/create) |
| `FAILED` | Exceção não tratada em alguma fase |

---

## Lookup de Device (prioridade)

Para cada linha do device-map, o sistema tenta localizar o device no GCDR nesta ordem:

```
1. gcdrDeviceId → DeviceRepository.getById()
2. tbId (externalId) → DeviceRepository.getByExternalId()
3. centralId + slaveId → lookup no map em memória (byCentralSlave)
```

Se não encontrado na etapa de CHECK → candidato a CREATE.
Na etapa DETECT_RELOCATIONS, busca no tenant inteiro (não apenas no customer) para identificar se é relocação.

---

## Comparação de Campos

Campos comparados para detectar divergência:

| Campo GCDR | Campo device-map | Lógica |
|-----------|-----------------|--------|
| `name` | `deviceName` | string igual (trim) |
| `displayName` | `deviceName` | string igual (trim) |
| `label` | `label` | string igual (trim) |
| `identifier` | `identifier` | string igual (trim) |
| `deviceType` | `deviceType` | string igual (trim) |
| `deviceProfile` | `deviceProfile` | string igual (trim) |
| `slaveId` | `slaveId` | número igual |
| `externalId` | `tbId` | string igual (trim) |

`UPDATE_IDENTIFIER` = apenas `identifier` difere.
`UPDATE` = qualquer outro campo difere (pode incluir `identifier` junto com outros).

---

## Modelo de Dados

Tabela: `device_sync_jobs`

```
id              uuid PK
tenant_id       uuid
customer_id     uuid
status          ENUM(QUEUED|RUNNING|DONE|PARTIAL|FAILED)
current_phase   ENUM(QUEUED|CHECK|ACTION_PLAN|DETECT_RELOCATIONS|RELOCATE|APPLY_UPDATES|CONSOLIDATE_CREATES|DONE)
dry_run         boolean
input_config    jsonb  — { defaultAssetId?: uuid }
input_files     jsonb  — [{ name: string, content: string }]
phases_summary  jsonb  — resumo por fase (contadores ok/fail)
log_entries     jsonb  — [{ ts, phase, level, message }]
error_message   text   — mensagem de erro fatal (se status=FAILED)
created_at      timestamptz
updated_at      timestamptz
completed_at    timestamptz
```

**Índices:**
- `(tenant_id, customer_id)` — listagem por customer
- `(tenant_id, status)` — filtro por status

**Nota:** `input_files` e `log_entries` ficam em JSONB. Para syncs grandes (>200 devices × 6 fases), `log_entries` pode crescer até ~200 KB. Aceitável para o volume atual.

---

## Formato do Device-Map (input)

Arquivo pipe-delimited, primeira linha é o header:

```
tbId|deviceName|label|identifier|deviceType|deviceProfile|slaveId|centralId|gcdrCustomerId|gcdrAssetId|gcdrDeviceId|gcdrSyncAt
```

Linhas em branco e linhas começando com `[` são ignoradas (section headers do ThingsBoard).

---

## `dryRun=true`

Com `dryRun=true`, todas as fases rodam normalmente mas nenhuma escrita é feita no banco:
- RELOCATE: loga `[DRY-RUN] Would relocate...`
- APPLY_UPDATES: loga `[DRY-RUN] Would patch...`
- CONSOLIDATE_CREATES: loga `[DRY-RUN] Would create...`

O job encerra com `DONE` mesmo em dry-run (sem contagem de falhas).

---

## Segurança

- Auth: `hybridAuthByMethod('devices:read', 'devices:write')` — mesmas API Keys usadas pelos devices
- Tenant-scoped: jobs são visíveis apenas para o tenant que os criou
- Não há endpoint de cancelamento (job roda até concluir)

---

## Limitações Conhecidas

1. **Restart do servidor**: Job `RUNNING` fica preso se o servidor reiniciar. Recriar manualmente.
2. **Limite de 10.000 devices por customer**: `list()` usa `limit: 10000`. Para clientes maiores, paginar a busca.
3. **Concorrência**: Não há lock — dois jobs para o mesmo customer podem rodar simultaneamente sem conflito explícito (a DB enforça constraints).
4. **JSONB log size**: Logs grandes (>1000 entradas) podem impactar leituras do JSONB.

---

## Melhorias Futuras (RFC-0023 roadmap)

- [ ] Migrar para BullMQ + Redis para persistência entre restarts
- [ ] Webhook ao completar job
- [ ] SSE (Server-Sent Events) para streaming do log em tempo real
- [ ] Agendamento de sync recorrente (`cron`)
- [ ] Preview de diff antes de aplicar (`dryRun` mais interativo)
- [ ] Lock por customer (evitar concorrência)
