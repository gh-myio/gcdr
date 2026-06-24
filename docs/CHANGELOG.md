# Changelog — GCDR

> Histórico de mudanças do backend. Extraído do antigo `docs/ONBOARDING.md` (que agora redireciona para o [README](../README.md)). Entradas mais recentes no topo.

## 2026-03-10

**Devices: remoção da constraint `devices_tenant_identifier_unique`**
- Constraint `UNIQUE(tenant_id, identifier)` removida — identificadores Modbus curtos (ex: `CAG`, `TEMPERATURA`) se repetem entre centrais/slaves do mesmo tenant sem conflito real
- Index de lookup `devices_identifier_idx` mantido para performance de busca
- Migration manual: `scripts/db/migrations/fix-identifier-unique-constraint.sql`
- Resolvia 37 erros de `apply-updates.sh` que falhavam por colisão de constraint

**Devices: endpoint `POST /devices/:id/move`**
- Endpoint para relocar device entre customers e/ou assets: `POST /devices/:id/move` com body `{newAssetId, newCustomerId}`
- Substituiu o uso incorreto de `PATCH /devices/:id` nos scripts de manutenção

**CustomerRepository: correção de erro 22P02 (malformed array literal)**
- `getAncestors` usava `sql\`${customers.id} = ANY(${ancestorIds})\`` que serializava o array JS como string literal (erro PostgreSQL `22P02`)
- Corrigido para `inArray(customers.id, ancestorIds)` (drizzle-orm)

**engine-check-inconformidades: pipeline multi-customer**
- Diretório `scripts/api/engine-check-inconformidades/` é agora o canônico (substitui `check-inconformidades-montserrat/`)
- Scripts usam `--customer <name>` e armazenam dados em `customers/<name>/`
- `generate-registry.sh` (Step 4) gera `device-registry-*.txt` (pipe-delimited) como mapa de referência para ThingsBoard

**API Keys: campo `hierarchyAccess`**
- `SELF` | `SUBTREE` | `TENANT` — controla o nível da árvore de customers que a chave acessa em `GET /customers/:id/tree`

**RFC-0023: Device Sync Job API**
- `POST /device-sync/jobs` executa o pipeline completo in-process (sem Redis/BullMQ), 6 fases: CHECK → ACTION_PLAN → DETECT_RELOCATIONS → RELOCATE → APPLY_UPDATES → CONSOLIDATE_CREATES
- Polling via `GET /device-sync/jobs/:jobId` e log via `.../log`; tabela `device_sync_jobs` com `phases_summary`/`log_entries` JSONB

## 2026-03-06

**RFC-0021: Template Types + Temas por tipo**
- Nova tabela `template_types` (PK = `type`) com `label`/`description`/`icon`/`sort_order`/`active`; 6 tipos canônicos (`EMAIL_ALARM`, `EMAIL_REPORT`, `EMAIL_WELCOME`, `RELEASE_NOTE`, `NOTIFICATION`, `INSIGHT`)
- Endpoints `GET /template-types`, `GET /template-types/:type`, `PATCH /template-types/:type`
- `look_and_feels.template_type` (FK) — tema por tipo de email; `UNIQUE (customer_id, template_type) WHERE template_type IS NOT NULL`; fallback customer+tipo → customer+global → MYIO+tipo → MYIO+global
- Frontend guides: `docs/frontend/FRONTEND-Themes-TemplateTypes.md`, `FRONTEND-Users-Groups-Roles.md`

## 2026-03-05

**RFC-0021: HTML Templates Engine**
- Módulo de templates HTML para email; tabela `templates` (`slug`/`type`/`status`/`html_content`/`version`)
- 8 endpoints; render com `{{variable}}` e `{{#each list}}...{{/each}}` (aninhamento); soft delete via `ARCHIVED`

**`GET /customers/:id/ancestors`** — cadeia de ancestrais (root → pai imediato)

## 2026-03-04

**RFC-0020: Public Single Apps**
- Apps públicos de formulário; 2 tabelas (`public_single_apps` + `public_single_app_responses` versionadas)
- `response_group_id` agrupa revisões; `response_version` incrementa; `is_latest` com índice único parcial; `changes_from_previous` com diff dot-notation (`flatDiff()`)
- 12 endpoints (5 gestão + 7 respostas)

**Force Delete Customer** — `DELETE /customers/:id/force` deleta customer + árvore + dados associados em uma transação; evento `CUSTOMER_FORCE_DELETED`

## 2026-02-26

**Device: campos `code` e `label`** — migration `0009_devices_code_label.sql`
**Device ↔ Rules** — `GET /devices/:id/rules` e `GET /rules/:id/devices` (`{ items, count }`)
**Rules: filtro `?search=`** em `GET /rules` (ILIKE por nome)
**Auth: API Key em `GET /customers/:customerId/rules`** (além de JWT)
**Script ops:** `fix-moxuara-malformed-uuid.sql` (corrige `scope_entity_id` com `"` trailing — double-serialization)

## 2026-02-23

**Alarm Bundle: invalidação de cache** — `DELETE /customers/:customerId/alarm-rules/bundle/cache` (204; só JWT)
**Device: unicidade de nome por customer** — `devices_tenant_customer_name_unique` (migration `0008`)

## 2026-02-22

**ExternalId lookup (ThingsBoard)** — `GET /customers/external/:externalId` (`?deep=1`, `?allRules=1`, `?filterOnlyDevicesWithRules=1`), `GET /devices/external/:externalId`, `GET /customers/:customerId/devices`; coluna `external_id` (migration `0006`); RFC-0017
**Rules: múltiplos devices por rule** — coluna `scope_entity_ids uuid[]` (migration `0007`); match em `scope_entity_id = X OR scope_entity_ids @> ARRAY[X]`
**Scripts ops (Moxuara):** asset/central setup + elevator rules

## 2026-02-20

**Decision Engine Guard Configs** — `dedup`, `cooldown`, `hysteresisGuard`, `digest` em `AlarmThresholdConfig`
**Device Lookup `centralId` + `slaveId`** — filtros em `GET /devices`
**Paginação `total`/`totalPages`** — em todos os 27 endpoints paginados (helper `countWhere()`)
**OpenAPI** — schemas de Rule reescritos (4 configs tipados, priority enum, guard configs)
**Error Handler** — 4xx logam linha única; 5xx mantêm stack trace

## 2026-02-11

**Remoção do EventService (AWS EventBridge)** — eventos externos removidos; audit logs locais (RFC-0009) continuam; 14 services atualizados
**Roles no Login** — carregadas de `AuthorizationService.getUserRoleKeys()`; incluídas na resposta e no JWT (login, MFA, refresh)
